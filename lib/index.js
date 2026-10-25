import { nativeReviewRequest, reinforceReviewRequest, ReviewFormatError } from './protocol.js';
import { collectReviewStream, inspectReviewChunks, normalizedChunks } from './stream.js';

export const name = 'review-format-guard';
export const inject = ['llm'];

export function resolveOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('review-format-guard: invalid plugin options');
  const defaults = { enabled: true, providerIds: [], retries: 2, timeoutMs: 60000, retryDelayMs: 500, maxBytes: 262144, maxChunks: 8192 };
  if (Object.keys(input).some(key => !Object.hasOwn(defaults, key))) throw new TypeError('review-format-guard: unknown plugin option');
  const options = { ...defaults, ...input };
  if (typeof options.enabled !== 'boolean') throw new TypeError('review-format-guard: enabled must be boolean');
  if (!Array.isArray(options.providerIds) || options.providerIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new TypeError('review-format-guard: providerIds must be a list of nonempty route names; an empty list covers all native review routes');
  }
  for (const [key, low, high] of [['retries', 0, 2], ['timeoutMs', 1, 120000], ['retryDelayMs', 0, 5000], ['maxBytes', 1024, 1048576], ['maxChunks', 8, 16384]]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < low || options[key] > high) throw new TypeError(`review-format-guard: invalid ${key}`);
  }
  return Object.freeze({ ...options, providerIds: Object.freeze([...options.providerIds]) });
}

function cancellation() {
  return new ReviewFormatError('REVIEW_CANCELLED', 'Review was cancelled.', false);
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
  logger?.info?.(`review-format-guard mounted; native policy 0.2.1-rc.3; max attempts=${options.retries + 1}; no authorization exceptions`);

  async function* proxyReview(request, id) {
    const preparedRequest = reinforceReviewRequest(request);
    const parentSignal = request.signal ? AbortSignal.any([request.signal, lifecycle.signal]) : lifecycle.signal;
    let lastError;
    let completedAttempts = 0;
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      if (parentSignal.aborted) { lastError = cancellation(); break; }
      const controller = new AbortController();
      completedAttempts++;
      attempts.add(controller);
      const timeout = setTimeout(() => controller.abort(new ReviewFormatError('REVIEW_TIMEOUT', 'Review attempt timed out.')), options.timeoutMs);
      const signal = AbortSignal.any([parentSignal, controller.signal]);
      // A fresh auxiliary call re-enters the official waterfall. Calling next()
      // repeatedly would consume listeners and bypass other plugins on retry.
      const outgoing = Object.freeze({ ...preparedRequest, signal });
      forwarded.add(outgoing);
      try {
        const chunks = await collectReviewStream(llm.stream(outgoing), signal, options);
        const inspection = inspectReviewChunks(chunks);
        if (parentSignal.aborted) throw cancellation();
        const accepted = normalizedChunks(chunks, inspection);
        logger?.info?.(`review-format-guard request=${id} attempt=${attempt + 1} accepted=${inspection.changed ? 'normalized' : 'unchanged'}`);
        for (const chunk of accepted) {
          if (parentSignal.aborted) throw cancellation();
          yield chunk;
        }
        return;
      } catch (error) {
        lastError = error instanceof ReviewFormatError ? error : new ReviewFormatError('REVIEW_STREAM_FAILURE', 'Review dispatch failed.', false);
        // No raw text, credentials, history, tool arguments or provider errors in logs.
        logger?.warn?.(`review-format-guard request=${id} attempt=${attempt + 1} rejected=${lastError.code}`);
      } finally {
        clearTimeout(timeout);
        controller.abort(cancellation());
        attempts.delete(controller);
        forwarded.delete(outgoing);
      }
      if (parentSignal.aborted || !lastError.retryable || attempt === options.retries) break;
      try { await pause(options.retryDelayMs * (attempt + 1), parentSignal); } catch { lastError = cancellation(); break; }
    }
    yield {
      type: 'finish',
      reason: {
        kind: parentSignal.aborted ? 'aborted' : 'error',
        failure: { code: lastError?.code ?? 'REVIEW_FORMAT_INVALID', message: `Review format guard: after ${completedAttempts} attempt(s): ${lastError?.message ?? 'No valid review response.'}` },
      },
    };
  }
}
