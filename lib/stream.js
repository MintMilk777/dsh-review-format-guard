import { normalizeDecision, ReviewFormatError } from './protocol.js';

function invalid(message) {
  throw new ReviewFormatError('REVIEW_STREAM_INVALID', message);
}

/** Validate the complete stream before releasing any successful content. */
export function inspectReviewChunks(chunks) {
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
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') invalid('Invalid review stream item.');
    if (finish) invalid('Review emitted data after its terminal finish.');
    if (chunk.type === 'finish') {
      if (!chunk.reason || typeof chunk.reason.kind !== 'string') invalid('Review has an invalid terminal outcome.');
      finish = chunk;
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        const code = chunk.reason.failure?.code;
        const retryable = ['RATE_LIMIT', 'TIMEOUT', 'SERVER', 'TRANSPORT', 'NETWORK', 'NETWORK_ERROR', 'CONNECTION_ERROR', 'EMPTY_RESPONSE'].includes(code);
        throw new ReviewFormatError('REVIEW_UPSTREAM_FAILURE', 'Review provider failed or cancelled the response.', chunk.reason.kind !== 'aborted' && retryable);
      }
      if (chunk.reason.kind !== 'stop') invalid('Review did not end with a normal stop.');
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
  if (!finish) invalid('Review stream ended without a terminal outcome.');
  const visible = [...blocks.values()].filter(state => state.text.trim() !== '');
  const final = visible.at(-1);
  if (!final || final.type !== 'text' || visible.slice(0, -1).some(state => state.type !== 'reasoning')) {
    invalid('Review must contain reasoning followed by exactly one text conclusion.');
  }
  const result = normalizeDecision(final.text);
  return { ...result, changed: result.changed || reasoningRepairs.size > 0, reasoningRepairs, index: final.index };
}

/** Update both deltas and completed blocks; never leave conflicting copies. */
export function normalizedChunks(chunks, inspection) {
  if (!inspection.changed) return chunks;
  let emittedText = false;
  const result = [];
  for (const chunk of chunks) {
    if (chunk.type === 'block-end' && inspection.reasoningRepairs?.has(chunk.index)) {
      result.push({ ...chunk, block: { type: 'reasoning', text: inspection.reasoningRepairs.get(chunk.index) } });
    } else if (chunk.type === 'text-delta' && chunk.index === inspection.index) {
      if (!emittedText) result.push({ ...chunk, text: inspection.text });
      emittedText = true;
    } else if (chunk.type === 'block-end' && chunk.index === inspection.index) {
      result.push({ ...chunk, block: { ...chunk.block, text: inspection.text } });
    } else if (chunk.type === 'finish' && chunk.replayState !== undefined) {
      const { replayState, ...withoutStaleReplay } = chunk;
      result.push(withoutStaleReplay);
    } else result.push(chunk);
  }
  return result;
}

function cancelled(signal) {
  return new ReviewFormatError(signal?.reason?.code === 'REVIEW_TIMEOUT' ? 'REVIEW_TIMEOUT' : 'REVIEW_CANCELLED',
    signal?.reason?.code === 'REVIEW_TIMEOUT' ? 'Review attempt timed out.' : 'Review was cancelled.',
    signal?.reason?.code === 'REVIEW_TIMEOUT');
}

/** Race reads against cancellation and cap memory even for reasoning/delta floods. */
export async function collectReviewStream(stream, signal, limits) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') invalid('Review provider did not return an async stream.');
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [];
  let bytes = 0;
  let completed = false;
  let rejectAbort;
  const onAbort = () => rejectAbort(cancelled(signal));
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const item = await Promise.race([iterator.next(), aborted]);
      if (item.done) { completed = true; return chunks; }
      if (chunks.length >= limits.maxChunks) throw new ReviewFormatError('REVIEW_SIZE_LIMIT', 'Review exceeded its stream item budget.');
      let encoded;
      try { encoded = JSON.stringify(item.value); } catch { invalid('Review returned an invalid stream item.'); }
      if (typeof encoded !== 'string') invalid('Review returned an invalid stream item.');
      bytes += Buffer.byteLength(encoded);
      if (bytes > limits.maxBytes) throw new ReviewFormatError('REVIEW_SIZE_LIMIT', 'Review exceeded its byte budget.');
      // An adapter may reuse a mutable chunk object. Preserve what arrived at
      // this point in time instead of letting later mutation rewrite a verdict.
      chunks.push(JSON.parse(encoded));
    }
  } catch (error) {
    if (signal.aborted) throw cancelled(signal);
    if (error instanceof ReviewFormatError) throw error;
    throw new ReviewFormatError('REVIEW_STREAM_FAILURE', 'Review stream failed before validation.', false);
  } finally {
    signal.removeEventListener('abort', onAbort);
    // Downstream gets the same abort signal; do not hang teardown on a broken iterator.
    if (!completed && typeof iterator.return === 'function') {
      try { Promise.resolve(iterator.return()).catch(() => {}); } catch {}
    }
  }
}
