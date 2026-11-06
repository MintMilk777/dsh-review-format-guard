import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { collectReviewStream, inspectReviewChunks } from '../lib/stream.js';
import { resolveOptions } from '../lib/index.js';
import { createAttemptWait } from '../lib/wait.js';
import { ReviewFormatError } from '../lib/protocol.js';
import { harness, chunks, collect, deny } from '../scripts/harness-fixture.mjs';
import { reviewRequest } from '../scripts/host-fixture.mjs';

function flood(state, count = 50000) {
  return (async function* () {
    try {
      for (let i = 0; i < count; i++) {
        state.reads++;
        yield { type: 'reasoning-delta', index: 0, text: 'x' };
      }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'x'.repeat(count) } };
      yield* chunks(deny).map(c => c.index === undefined ? c : { ...c, index: 1 });
    } finally { state.closed = true; }
  })();
}

for (const action of ['cancel', 'unload']) test(`native timer can ${action} a fast generator before validation`, async () => {
  const state = { reads: 0 }, controller = new AbortController();
  const h = harness([() => flood(state)]);
  let atAction;
  const timer = setTimeout(() => {
    atAction = state.reads;
    if (action === 'cancel') controller.abort(); else h.dispose();
  }, 5);
  try {
    const out = await collect(h.ctx.llm.stream(reviewRequest({ signal: controller.signal })));
    assert.ok(atAction > 0 && atAction < 50000);
    assert.equal(state.reads, atAction, 'No next after cancellation');
    assert.equal(state.closed, true);
    assert.equal(h.calls.length, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0].reason.kind, 'aborted');
    assert.equal(out[0].reason.failure.code, 'REVIEW_CANCELLED');
  } finally { clearTimeout(timer); h.dispose(); }
});

test('fast successful source lets native timers and immediates run, retaining one denial', async t => {
  const state = { reads: 0 }, seen = [];
  const timer = setTimeout(() => seen.push(['timer', state.reads]), 0);
  const immediate = setImmediate(() => seen.push(['immediate', state.reads]));
  const start = performance.now();
  try {
    const out = await collectReviewStream(flood(state), new AbortController().signal, resolveOptions());
    assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
    assert.equal(seen.length, 2);
    for (const [, reads] of seen) assert.ok(reads > 0 && reads < 50000);
    assert.ok(seen.find(([kind]) => kind === 'immediate')[1] <= 256);
    assert.ok(out.length < 32, 'Delta merging remains enabled');
    const elapsed = performance.now() - start;
    // Deliberately broad: reject per-character sleep, not noisy host performance.
    assert.ok(elapsed < 10000, `50000 events took ${elapsed}ms`);
    t.diagnostic(`50000 one-character events: ${elapsed.toFixed(1)}ms; retained ${out.length} chunks`);
  } finally { clearTimeout(timer); clearImmediate(immediate); }
});

test('one pending abort promise does not accumulate a reaction for each raw event', async t => {
  const counts = new WeakMap();
  let maximum = 0;
  const then = Promise.prototype.then;
  const mock = t.mock.method(Promise.prototype, 'then', function (...args) {
    const count = (counts.get(this) ?? 0) + 1;
    counts.set(this, count); maximum = Math.max(maximum, count);
    return Reflect.apply(then, this, args);
  });
  try {
    await collectReviewStream(flood({ reads: 0 }, 2000), new AbortController().signal, resolveOptions());
  } finally { mock.mock.restore(); }
  assert.ok(maximum <= 2, `One promise received ${maximum} subscriptions`);
});

test('elapsed slice budget yields even before the event-count limit', async t => {
  let now = 0, reads = 0, observed;
  t.mock.method(performance, 'now', () => now);
  const input = chunks(deny);
  const immediate = setImmediate(() => { observed = reads; });
  const source = { [Symbol.asyncIterator]() { return { next() {
    now += 9;
    return Promise.resolve(reads < input.length ? { value: input[reads++], done: false } : { done: true });
  } }; } };
  try {
    await collectReviewStream(source, new AbortController().signal, resolveOptions());
    assert.equal(observed, 1);
  } finally { clearImmediate(immediate); }
});

test('abort during a fairness yield cleans its listener and starts no further read', async () => {
  const controller = new AbortController(), state = { reads: 0 };
  let atAbort;
  const immediate = setImmediate(() => { atAbort = state.reads; controller.abort(); });
  try {
    await assert.rejects(collectReviewStream(flood(state), controller.signal, resolveOptions()), { code: 'REVIEW_CANCELLED' });
    assert.ok(atAbort > 0 && atAbort <= 256);
    assert.equal(state.reads, atAbort);
    assert.equal(state.closed, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await turn();
  } finally { clearImmediate(immediate); }
});

test('real total deadline interrupts continuous meaningful content and releases wait listeners', async () => {
  const controller = new AbortController(), state = { reads: 0 };
  const options = resolveOptions({ timeoutMs: 5 });
  const wait = createAttemptWait(controller, options);
  try {
    await assert.rejects(collectReviewStream(flood(state), controller.signal, options, wait), error => {
      assert.equal(error.code, 'REVIEW_TIMEOUT');
      assert.match(error.message, /total deadline/);
      return true;
    });
    assert.ok(state.reads < 50000);
    assert.equal(state.closed, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally { wait.dispose(); }
});

test('each settled read removes its abort listener before the next read', async () => {
  const controller = new AbortController(), signal = controller.signal;
  let adds = 0, removes = 0, peak = 0, reads = 0;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { if (args[0] === 'abort') adds++; return add(...args); };
  signal.removeEventListener = (...args) => { if (args[0] === 'abort') removes++; return remove(...args); };
  const input = chunks(deny);
  const stream = { [Symbol.asyncIterator]() { return { next() {
    peak = Math.max(peak, getEventListeners(signal, 'abort').length);
    assert.equal(adds - removes, 1);
    assert.equal(removes, reads);
    return Promise.resolve(reads < input.length ? { value: input[reads++], done: false } : (++reads, { done: true }));
  } }; } };
  await collectReviewStream(stream, signal, resolveOptions());
  assert.equal(peak, 1);
  assert.equal(adds, removes);
  assert.equal(getEventListeners(signal, 'abort').length, 0);
});

for (const outcome of ['cancel', 'timeout']) test(`${outcome} does not await stuck next/return and observes their late rejections`, async () => {
  const controller = new AbortController();
  let rejectNext, rejectReturn, returns = 0;
  const stream = { [Symbol.asyncIterator]() { return {
    next() { return new Promise((_, reject) => { rejectNext = reject; }); },
    return() { returns++; return new Promise((_, reject) => { rejectReturn = reject; }); },
  }; } };
  const wait = outcome === 'timeout' ? createAttemptWait(controller, resolveOptions({ timeoutMs: 5 })) : undefined;
  const timer = outcome === 'cancel' ? setTimeout(() => controller.abort(), 5) : undefined;
  try {
    await assert.rejects(collectReviewStream(stream, controller.signal, resolveOptions(), wait), {
      code: outcome === 'cancel' ? 'REVIEW_CANCELLED' : 'REVIEW_TIMEOUT',
    });
    assert.equal(returns, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    // node:test also fails on unhandledRejection after the test has completed.
    rejectNext(new Error('late next rejection'));
    rejectReturn(new Error('late close rejection'));
    await turn(); await turn();
  } finally { clearTimeout(timer); wait?.dispose(); }
});

for (const outcome of ['early failure', 'cancel', 'timeout']) {
  for (const close of ['getter throws', 'call throws', 'rejects', 'stays pending']) {
    test(`${outcome} survives return that ${close}, reading once with iterator receiver`, { timeout: 2000 }, async () => {
      const controller = new AbortController();
      const timeout = new ReviewFormatError('REVIEW_TIMEOUT', 'total deadline', true);
      let reads = 0, accesses = 0, calls = 0, receiver, rejectClose;
      const iterator = {
        next() {
          reads++;
          if (outcome !== 'early failure') {
            controller.abort(outcome === 'timeout' ? timeout : undefined);
            return new Promise(() => {});
          }
          return Promise.resolve({ done: false, value: {
            type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } },
          } });
        },
        get return() {
          accesses++;
          if (close === 'getter throws') throw new Error('Fictional close accessor failure');
          return function () {
            calls++;
            receiver = this;
            if (close === 'call throws') throw new Error('Fictional close call failure');
            if (close === 'rejects') return Promise.reject(new Error('Fictional close rejection'));
            return new Promise((_, reject) => { rejectClose = reject; });
          };
        },
      };
      const stream = { [Symbol.asyncIterator]() { return iterator; } };
      await assert.rejects(collectReviewStream(stream, controller.signal, resolveOptions()), error => {
        assert.equal(error.code, outcome === 'early failure' ? 'REVIEW_UPSTREAM_CONTEXT_WINDOW_EXCEEDED'
          : outcome === 'cancel' ? 'REVIEW_CANCELLED' : 'REVIEW_TIMEOUT');
        if (outcome === 'timeout') assert.equal(error, timeout);
        return true;
      });
      assert.equal(reads, 1);
      assert.equal(accesses, 1);
      assert.equal(calls, close === 'getter throws' ? 0 : 1);
      if (calls) assert.equal(receiver, iterator);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      // Settlement above must not wait for close; observe even a later rejection.
      rejectClose?.(new Error('Fictional late close rejection'));
      // node:test reports any unhandled rejection as a failure.
      await turn(); await turn();
    });
  }
}

test('native deadline callback can abort fast content without relying on wait.check', async () => {
  const controller = new AbortController(), state = { reads: 0 };
  const timer = setTimeout(() => controller.abort(new ReviewFormatError('REVIEW_TIMEOUT', 'total deadline', true)), 5);
  try {
    await assert.rejects(collectReviewStream(flood(state), controller.signal, resolveOptions()), { code: 'REVIEW_TIMEOUT' });
    assert.ok(state.reads < 50000);
    assert.equal(state.closed, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally { clearTimeout(timer); }
});

test('pre-abort never invokes next; synchronous abort inside next observes rejection and cleans up', async () => {
  for (const preAbort of [true, false]) {
    const controller = new AbortController();
    let reads = 0, returns = 0;
    if (preAbort) controller.abort();
    const stream = { [Symbol.asyncIterator]() { return {
      next() { reads++; controller.abort(); return Promise.reject(new Error('private')); },
      return() { returns++; throw new Error('private close'); },
    }; } };
    await assert.rejects(collectReviewStream(stream, controller.signal, resolveOptions()), { code: 'REVIEW_CANCELLED' });
    assert.equal(reads, preAbort ? 0 : 1);
    assert.equal(returns, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await turn();
  }
});

for (const synchronous of [true, false]) test(`connection failure (${synchronous ? 'throw' : 'reject'}) preserves bounded retries and redaction`, async () => {
  const h = harness([() => ({ [Symbol.asyncIterator]() { return {
    next() {
      const error = Object.assign(new Error('PRIVATE CONNECTION'), { code: 'ECONNRESET' });
      if (synchronous) throw error;
      return Promise.reject(error);
    },
  }; } })]);
  try {
    const out = await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(h.calls.length, 3);
    assert.equal(out.length, 1);
    assert.equal(out[0].reason.failure.code, 'REVIEW_CONNECTION_FAILURE');
    assert.equal(JSON.stringify([out, h.logs]).includes('PRIVATE'), false);
    for (const call of h.calls) assert.equal(getEventListeners(call.signal, 'abort').length, 0);
  } finally { h.dispose(); }
});
