import { performance } from 'node:perf_hooks';
import { nativeReviewRequest, reinforceReviewRequest } from './protocol.js';
import { collectReviewStream, inspectReviewChunks, normalizedChunks } from './stream.js';
import { createAttemptWait } from './wait.js';
import { cancellation, streamFailure, safeFailure } from './failures.js';

export const name = 'review-format-guard';
export const inject = ['llm'];

export function resolveOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('review-format-guard: invalid plugin options');
  const defaults = { enabled: true, providerIds: [], retries: 2, timeoutMs: 180000, firstContentTimeoutMs: 120000, idleTimeoutMs: 30000, retryDelayMs: 500, maxBytes: 262144, maxChunks: 65536, maxContentBytes: 262144, maxReplayBytes: 262144, maxBufferedChunks: 8192, maxMemoryBytes: 4194304 };
  if (Object.keys(input).some(key => !Object.hasOwn(defaults, key))) throw new TypeError('review-format-guard: unknown plugin option');
  const options = { ...defaults, ...input };
  if (typeof options.enabled !== 'boolean') throw new TypeError('review-format-guard: enabled must be boolean');
  if (!Array.isArray(options.providerIds) || options.providerIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new TypeError('review-format-guard: providerIds must be a list of nonempty route names; an empty list covers all native review routes');
  }
  for (const [key, low, high] of [['retries', 0, 2], ['timeoutMs', 1, 600000], ['firstContentTimeoutMs', 1, 600000], ['idleTimeoutMs', 1, 600000], ['retryDelayMs', 0, 5000], ['maxBytes', 1024, 1048576], ['maxChunks', 8, 131072], ['maxContentBytes', 1024, 1048576], ['maxReplayBytes', 1024, 1048576], ['maxBufferedChunks', 8, 16384], ['maxMemoryBytes', 1024, 16777216]]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < low || options[key] > high) throw new TypeError(`review-format-guard: invalid ${key}`);
  }
  return Object.freeze({ ...options, providerIds: Object.freeze([...options.providerIds]) });
}

async function pause(ms, signal) {
  if (signal.aborted) throw cancellation();
  await new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(cancellation()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Register only an owned LLM listener; no files, adapters or tool gates are patched. */
export function apply(ctx, input = {}) {
  const options = resolveOptions(input);
  if (!options.enabled) return;
  const lifecycle = new AbortController();
  const forwarded = new WeakSet();
  const attempts = new Set();
  const llm = ctx.llm;
  const logger = ctx.logger;
  let sequence = 0;
  ctx.effect(() => () => {
    lifecycle.abort(cancellation());
    for (const controller of attempts) controller.abort(cancellation());
  }, 'review-format-guard lifecycle');

  // The callback MUST return an AsyncIterable synchronously, not a Promise.
  ctx.on('llm/stream', (request, next) => {
    if (forwarded.has(request) || (options.providerIds.length > 0 && !options.providerIds.includes(request?.provider)) || !nativeReviewRequest(request)) return next();
    return proxyReview(request, ++sequence);
  }, { prepend: true });
  logger?.info?.(`review-format-guard mounted; verified native review protocols; max attempts=${options.retries + 1}; no authorization exceptions`);

  async function* proxyReview(request, id) {
    const preparedRequest = reinforceReviewRequest(request);
    const parentSignal = request.signal ? AbortSignal.any([request.signal, lifecycle.signal]) : lifecycle.signal;
    let lastError;
    let completedAttempts = 0;
    const history = [];
    let attemptLimit = options.retries + 1;
    for (let attempt = 0; attempt < attemptLimit; attempt++) {
      if (parentSignal.aborted) { lastError = cancellation(); break; }
      const controller = new AbortController();
      const started = performance.now();
      completedAttempts++;
      attempts.add(controller);
      const wait = createAttemptWait(controller, options, parentSignal);
      const signal = AbortSignal.any([parentSignal, controller.signal]);
      // A fresh auxiliary call re-enters the official waterfall. Calling next()
      // repeatedly would consume listeners and bypass other plugins on retry.
      const outgoing = Object.freeze({ ...preparedRequest, signal });
      forwarded.add(outgoing);
      try {
        const chunks = await collectReviewStream(llm.stream(outgoing), signal, options, wait);
        const inspection = inspectReviewChunks(chunks);
        wait.check();
        if (parentSignal.aborted) throw cancellation();
        const accepted = normalizedChunks(chunks, inspection);
        wait.check();
        // Validation completed within the attempt budget. Consumer backpressure
        // while replaying this validated buffer is not provider idle time.
        wait.dispose();
        logger?.info?.(`review-format-guard request=${id} attempt=${attempt + 1} accepted=${inspection.changed ? 'normalized' : 'unchanged'} elapsedMs=${Math.round(performance.now() - started)} history=${history.join(',') || 'none'}`);
        for (const chunk of accepted) {
          if (parentSignal.aborted) throw cancellation();
          yield chunk;
        }
        return;
      } catch (error) {
        lastError = parentSignal.aborted ? cancellation() : safeFailure(streamFailure(error));
        // Real output sizes vary between attempts. Allow one recovery attempt,
        // but once a resource limit occurs never exceed two total attempts.
        if (lastError.code === 'REVIEW_SIZE_LIMIT') attemptLimit = Math.min(attemptLimit, 2);
        history.push(`${attempt + 1}:${lastError.diagnostic ?? lastError.code}:${Math.round(performance.now() - started)}ms`);
        // No raw text, credentials, history, tool arguments or provider errors in logs.
        logger?.warn?.(`review-format-guard request=${id} attempt=${attempt + 1} rejected=${lastError.diagnostic ?? lastError.code} elapsedMs=${Math.round(performance.now() - started)}`);
      } finally {
        wait.dispose();
        controller.abort(cancellation());
        attempts.delete(controller);
        forwarded.delete(outgoing);
      }
      if (parentSignal.aborted || !lastError.retryable || attempt + 1 >= attemptLimit) break;
      try { await pause(options.retryDelayMs * (attempt + 1), parentSignal); } catch { lastError = cancellation(); break; }
    }
    yield {
      type: 'finish',
      reason: {
        kind: parentSignal.aborted ? 'aborted' : 'error',
        failure: { code: lastError?.code ?? 'REVIEW_FORMAT_INVALID', message: `Review format guard: after ${completedAttempts} attempt(s): ${lastError?.message ?? 'No valid review response.'} Attempts: ${history.join(', ') || 'none'}.` },
      },
    };
  }
}
