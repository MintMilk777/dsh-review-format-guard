import { normalizeDecision, ReviewFormatError } from './protocol.js';
import { upstreamFailure, streamFailure } from './failures.js';
import { streamBudget } from './budget.js';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

function invalid(message) {
  throw new ReviewFormatError('REVIEW_STREAM_INVALID', message);
}

/** Validate the complete stream before releasing any successful content. */
function reviewInspector() {
  const blocks = new Map();
  const reasoningRepairs = new Map();
  let finish;
  function block(index, type) {
    if (!Number.isSafeInteger(index) || index < 0 || Object.is(index, -0)) invalid('Invalid review block index.');
    if (type !== 'text' && type !== 'reasoning') invalid('Review response contains a non-text action block.');
    let state = blocks.get(index);
    if (!state) {
      state = { index, type, text: '', deltas: false, closed: false, started: false };
      blocks.set(index, state);
    }
    if (state.type !== type) invalid('Review block type changed.');
    return state;
  }
  function push(chunk) {
    if (!chunk || typeof chunk !== 'object') invalid('Invalid review stream item.');
    if (finish) invalid('Review emitted data after its terminal finish.');
    if (chunk.type === 'finish') {
      if (!chunk.reason || typeof chunk.reason.kind !== 'string') invalid('Review has an invalid terminal outcome.');
      finish = chunk;
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        throw upstreamFailure(chunk.reason);
      }
      if (chunk.reason.kind !== 'stop') {
        if (chunk.reason.kind === 'max-tokens') invalid('Review ended at its output token limit.');
        if (chunk.reason.kind === 'tool-calls') invalid('Review ended by requesting tool calls.');
        invalid('Review did not end with a normal stop.');
      }
    } else if (chunk.type === 'block-start') {
      const state = block(chunk.index, chunk.blockType);
      if (state.started || state.closed || state.deltas) invalid('Review block was started more than once or out of order.');
      state.started = true;
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const state = block(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning');
      if (state.closed || typeof chunk.text !== 'string') invalid('Review has invalid or late text deltas.');
      state.text += chunk.text;
      state.deltas = true;
    } else if (chunk.type === 'block-end') {
      const state = block(chunk.index, chunk.block?.type);
      if (state.closed || typeof chunk.block.text !== 'string') invalid('Review block ended more than once or has invalid text.');
      if (state.deltas && state.text !== chunk.block.text) {
        // Some adapters trim the final reasoning snapshot, but not its deltas.
        // Only that outer-whitespace difference is repairable. Verdict text
        // and any substantive reasoning difference remain strict conflicts.
        if (state.type !== 'reasoning' || state.text.trim() !== chunk.block.text.trim()) invalid('Review deltas disagree with the completed block.');
        reasoningRepairs.set(state.index, state.text);
      } else state.text = chunk.block.text;
      state.closed = true;
    } else if (chunk.type !== 'usage') {
      invalid('Review response contains an unsupported stream item.');
    }
  }
  function complete() {
    if (!finish) invalid('Review stream ended without a terminal outcome.');
    const visible = [...blocks.values()].filter(state => state.text.trim() !== '');
    const final = visible.at(-1);
    if (!final) invalid('Review contains no meaningful text or reasoning.');
    if (final.type !== 'text') invalid('Review has no final text conclusion.');
    if (visible.slice(0, -1).some(state => state.type !== 'reasoning')) invalid('Review contains multiple text conclusions or text before reasoning.');
    const blankBlocks = new Set([...blocks.values()].filter(state => state.text.trim() === '').map(state => state.index));
    const result = normalizeDecision(final.text);
    return { ...result, textChanged: result.changed, changed: result.changed || reasoningRepairs.size > 0 || blankBlocks.size > 0, reasoningRepairs, blankBlocks, index: final.index };
  }
  return { push, complete };
}

export function inspectReviewChunks(chunks) {
  const inspector = reviewInspector();
  for (const chunk of chunks) inspector.push(chunk);
  return inspector.complete();
}

/** Update both deltas and completed blocks; never leave conflicting copies. */
export function normalizedChunks(chunks, inspection) {
  if (!inspection.changed) return chunks;
  let emittedText = false;
  const result = [];
  for (const chunk of chunks) {
    // The native parser counts even blank blocks. Remove a whole verified
    // whitespace-only block, not just its snapshot; keep usage and every
    // meaningful block unchanged. Collection budgets still charge all input.
    if (inspection.blankBlocks?.has(chunk.index)
        && ['block-start', 'text-delta', 'reasoning-delta', 'block-end'].includes(chunk.type)) {
      continue;
    } else if (chunk.type === 'block-end' && inspection.reasoningRepairs?.has(chunk.index)) {
      const block = { ...chunk.block, type: 'reasoning', text: inspection.reasoningRepairs.get(chunk.index) };
      // A signature covers the old text; fixed adapter metadata does not.
      delete block.signature;
      result.push({ ...chunk, block });
    } else if (inspection.textChanged && chunk.type === 'text-delta' && chunk.index === inspection.index) {
      // Keep each event's adapter metadata, including events after the first.
      // Empty subsequent deltas preserve the normalized concatenation.
      const updated = { ...chunk, text: emittedText ? '' : inspection.text };
      // A delta signature may cover the entire block, not just this fragment.
      delete updated.signature;
      result.push(updated);
      emittedText = true;
    } else if (inspection.textChanged && chunk.type === 'block-end' && chunk.index === inspection.index) {
      const block = { ...chunk.block, text: inspection.text };
      delete block.signature;
      result.push({ ...chunk, block });
    } else if (chunk.type === 'finish' && chunk.replayState !== undefined) {
      const { replayState, ...withoutStaleReplay } = chunk;
      result.push(withoutStaleReplay);
    } else result.push(chunk);
  }
  return result;
}

function cancelled(signal) {
  if (signal?.reason instanceof ReviewFormatError && signal.reason.code === 'REVIEW_TIMEOUT') return signal.reason;
  return new ReviewFormatError('REVIEW_CANCELLED', 'Review was cancelled.', false);
}

// Each read owns its abort listener. Racing every read with one shared pending
// promise retains a reaction per raw event until cancellation, even after merging.
function nextOrAbort(iterator, signal) {
  return new Promise((resolve, reject) => {
    const settle = (callback, value) => {
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => settle(reject, cancelled(signal));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Observe rejection even when abort wins or next aborts synchronously.
      Promise.resolve(iterator.next()).then(
        item => settle(resolve, item), error => settle(reject, error),
      );
    } catch (error) { settle(reject, error); }
  });
}

/** Cancel reads promptly and bound memory and event-loop monopolization. */
export async function collectReviewStream(stream, signal, limits, wait) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') invalid('Review provider did not return an async stream.');
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [];
  const budget = streamBudget(limits);
  const inspector = reviewInspector();
  let completed = false;
  let eventsSinceYield = 0;
  let sliceStarted = performance.now();
  try {
    signal.throwIfAborted();
    while (true) {
      wait?.check();
      if (eventsSinceYield >= 256 || performance.now() - sliceStarted >= 8) {
        // A microtask await alone cannot run native cancellation/unload timers.
        await yieldToLoop(undefined, { signal });
        signal.throwIfAborted();
        wait?.check();
        eventsSinceYield = 0;
        sliceStarted = performance.now();
      }
      const item = await nextOrAbort(iterator, signal);
      // A producer may finish from its abort handler. Never treat that as a
      // successful end, nor let microtask-only producers outrun deadline timers.
      signal.throwIfAborted();
      wait?.check();
      if (item.done) { completed = true; return chunks; }
      budget.event();
      let encoded;
      try { encoded = JSON.stringify(item.value); } catch { invalid('Review returned an invalid stream item.'); }
      if (typeof encoded !== 'string') invalid('Review returned an invalid stream item.');
      budget.item(encoded);
      // An adapter may reuse a mutable chunk object. Preserve what arrived at
      // this point in time instead of letting later mutation rewrite a verdict.
      const chunk = JSON.parse(encoded);
      inspector.push(chunk);
      budget.append(chunks, chunk, encoded);
      wait?.observe(chunk);
      eventsSinceYield++;
    }
  } catch (error) {
    if (signal.aborted) throw cancelled(signal);
    if (error instanceof ReviewFormatError) throw error;
    throw streamFailure(error);
  } finally {
    // Downstream gets the same abort signal; do not hang teardown on a broken iterator.
    if (!completed) {
      try {
        const close = iterator.return;
        if (typeof close === 'function') Promise.resolve(close.call(iterator)).catch(() => {});
      } catch {}
    }
  }
}
