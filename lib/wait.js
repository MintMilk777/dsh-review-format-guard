import { performance } from 'node:perf_hooks';
import { ReviewFormatError } from './protocol.js';

/** Track content growth, not traffic. A closing snapshot is not another delta. */
function progressTracker() {
  const blocks = new Map();
  return chunk => {
    if (!chunk || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || Object.is(chunk.index, -0)) return false;
    const delta = chunk.type === 'text-delta' || chunk.type === 'reasoning-delta';
    const type = delta ? (chunk.type === 'text-delta' ? 'text' : 'reasoning') : chunk.block?.type;
    if ((!delta && chunk.type !== 'block-end') || !['text', 'reasoning'].includes(type)) return false;
    const text = delta ? chunk.text : chunk.block?.text;
    if (typeof text !== 'string') return false;
    let state = blocks.get(chunk.index);
    if (!state) { state = { type, deltas: false, closed: false }; blocks.set(chunk.index, state); }
    if (state.type !== type || state.closed) return false;
    if (delta) { state.deltas = true; return text.trim().length > 0; }
    state.closed = true;
    // With deltas, a final snapshot only confirms content already observed.
    // Conflicting snapshots remain the complete-stream validator's responsibility.
    return !state.deltas && text.trim().length > 0;
  };
}

/** One attempt, one immutable total deadline, and one content-dependent deadline. */
export function createAttemptWait(controller, options, parentSignal) {
  const started = performance.now();
  const totalDeadline = started + options.timeoutMs;
  let contentDeadline = started + options.firstContentTimeoutMs;
  let phase = 'first-content';
  let timer;
  let disposed = false;
  const progressed = progressTracker();

  function dispose() {
    disposed = true;
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', dispose);
    parentSignal?.removeEventListener('abort', cancel);
  }
  function cancel() {
    dispose();
  }
  controller.signal.addEventListener('abort', dispose, { once: true });
  parentSignal?.addEventListener('abort', cancel, { once: true });
  if (parentSignal?.aborted || controller.signal.aborted) dispose();

  function check() {
    if (controller.signal.aborted) throw controller.signal.reason;
    const now = performance.now();
    const deadline = Math.min(totalDeadline, contentDeadline);
    if (now < deadline) return;
    const stage = totalDeadline <= contentDeadline ? 'total' : phase;
    const messages = {
      total: 'Review attempt exceeded its total deadline.',
      'first-content': 'Review timed out waiting for first meaningful text or reasoning content.',
      idle: 'Review timed out without new meaningful text or reasoning content.',
    };
    const error = new ReviewFormatError('REVIEW_TIMEOUT', messages[stage], true);
    controller.abort(error);
    throw error;
  }
  function schedule() {
    clearTimeout(timer);
    if (disposed || controller.signal.aborted) return;
    timer = setTimeout(() => {
      try { check(); schedule(); } catch { /* The abort signal wakes pending reads. */ }
    }, Math.max(1, Math.ceil(Math.min(totalDeadline, contentDeadline) - performance.now())));
  }
  schedule();
  return {
    check,
    observe(chunk) {
      if (disposed) return;
      // Check first: a late chunk must never revive an expired deadline, even
      // when a synchronous producer has delayed the timer callback.
      check();
      if (progressed(chunk)) {
        phase = 'idle';
        contentDeadline = performance.now() + options.idleTimeoutMs;
        schedule();
      }
    },
    dispose,
  };
}
