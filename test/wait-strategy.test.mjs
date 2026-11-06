import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveOptions } from '../lib/index.js';
import { createAttemptWait } from '../lib/wait.js';
import { cancellation, streamFailure, upstreamFailure } from '../lib/failures.js';
import { ReviewFormatError } from '../lib/protocol.js';
import { reviewRequest, orderedReviewRequest } from '../scripts/host-fixture.mjs';
import { harness, chunks, collect, deny } from '../scripts/harness-fixture.mjs';

function clock(t) {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return ms => { now += ms; t.mock.timers.tick(ms); };
}
const delta = text => ({ type: 'reasoning-delta', index: 0, text });
const snapshot = text => ({ type: 'block-end', index: 0, block: { type: 'reasoning', text } });

test('wait defaults and explicit legacy total limits remain independent', () => {
  const defaults = resolveOptions();
  assert.equal(defaults.timeoutMs, 180000);
  assert.equal(defaults.firstContentTimeoutMs, 120000);
  assert.equal(defaults.idleTimeoutMs, 30000);
  assert.equal(resolveOptions({ timeoutMs: 60000 }).timeoutMs, 60000);
  for (const key of ['firstContentTimeoutMs', 'idleTimeoutMs']) {
    for (const value of [0, -1, 1.5, NaN, '30000', 600001]) assert.throws(() => resolveOptions({ [key]: value }));
  }
});

test('first content at 97.5 seconds survives the old 60 second limit', t => {
  const tick = clock(t), controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions());
  tick(97500);
  wait.observe(delta('Reviewing'));
  tick(20000);
  wait.observe(delta(' more'));
  assert.equal(controller.signal.aborted, false);
  wait.dispose();
});

test('continuous meaningful content cannot extend the total deadline', t => {
  const tick = clock(t), controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions());
  for (let i = 0; i < 8; i++) { tick(20000); wait.observe(delta('more')); }
  tick(20000);
  assert.equal(controller.signal.reason.code, 'REVIEW_TIMEOUT');
  assert.match(controller.signal.reason.message, /total deadline/);
  wait.dispose();
});

test('usage and whitespace never start or extend the first-content deadline', t => {
  const tick = clock(t), controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions());
  for (let i = 0; i < 5; i++) {
    tick(20000);
    wait.observe(delta(' \n\t'));
    wait.observe({ type: 'usage', usage: {} });
  }
  tick(20000);
  assert.match(controller.signal.reason.message, /first meaningful/);
  wait.dispose();
});

test('whitespace, usage and duplicate closing snapshots do not renew idle time', t => {
  const tick = clock(t), controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions());
  wait.observe(delta('reasoning'));
  tick(10000);
  wait.observe(delta(' '));
  wait.observe({ type: 'usage', usage: {} });
  wait.observe(snapshot('reasoning '));
  tick(10000);
  wait.observe(snapshot('reasoning '));
  tick(10000);
  assert.match(controller.signal.reason.message, /without new meaningful/);
  wait.dispose();
});

test('snapshot-only content starts idle waiting once', t => {
  const tick = clock(t), controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions());
  tick(90000);
  wait.observe(snapshot('reasoning'));
  tick(29999);
  assert.equal(controller.signal.aborted, false);
  tick(1);
  assert.match(controller.signal.reason.message, /without new meaningful/);
  wait.dispose();
});

test('explicit legacy total deadline still wins over first-content allowance', t => {
  const tick = clock(t), controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions({ timeoutMs: 60000 }));
  tick(60000);
  assert.match(controller.signal.reason.message, /total deadline/);
  wait.dispose();
});

test('late synchronous content cannot revive an expired deadline', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const controller = new AbortController();
  const wait = createAttemptWait(controller, resolveOptions());
  now = 120001;
  assert.throws(() => wait.observe(delta('late')), { code: 'REVIEW_TIMEOUT' });
  wait.dispose();
});

test('cancel, unload signal and explicit disposal clear timers synchronously', t => {
  const timers = new Set();
  t.mock.method(globalThis, 'setTimeout', () => { const token = {}; timers.add(token); return token; });
  t.mock.method(globalThis, 'clearTimeout', token => timers.delete(token));
  for (const mode of ['controller', 'parent', 'dispose']) {
    const controller = new AbortController(), parent = new AbortController();
    const wait = createAttemptWait(controller, resolveOptions(), parent.signal);
    assert.equal(timers.size, 1);
    if (mode === 'controller') controller.abort(cancellation());
    else if (mode === 'parent') parent.abort();
    else wait.dispose();
    assert.equal(timers.size, 0);
    wait.dispose();
  }
});

for (const mode of ['cancel', 'unload']) test(mode + ' interrupts a stalled iterator and dispatches no retry', async () => {
  const controller = new AbortController();
  const h = harness([() => ({ [Symbol.asyncIterator]() { return this; }, next() { return new Promise(() => {}); }, return() { return Promise.resolve({ done: true }); } })]);
  const pending = collect(h.ctx.llm.stream(reviewRequest({ signal: controller.signal })));
  if (mode === 'cancel') controller.abort(); else h.dispose();
  const out = await pending;
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.kind, 'aborted');
  assert.equal(h.calls.length, 1);
  if (mode === 'cancel') h.dispose();
});

for (const code of ['CONTEXT_WINDOW_EXCEEDED', 'QUOTA', 'ACCOUNT_QUOTA', 'AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL', 'INVALID_REQUEST', 'PRIVATE_UNKNOWN_CODE']) {
  test('nonretryable upstream ' + code + ' is classified without raw diagnostics', async () => {
    const h = harness([[{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'PRIVATE_RAW_MESSAGE' } } }], chunks(deny)]);
    const out = await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(h.calls.length, 1);
    assert.equal(out[0].reason.kind, 'error');
    const diagnostics = JSON.stringify([out, h.logs]);
    assert.equal(diagnostics.includes('PRIVATE_RAW_MESSAGE'), false);
    assert.equal(diagnostics.includes('PRIVATE_UNKNOWN_CODE'), false);
    if (code.endsWith('CREDENTIAL')) assert.equal(out[0].reason.failure.code, 'REVIEW_UPSTREAM_AUTH');
    h.dispose();
  });
}

for (const code of ['SERVER', 'TRANSPORT', 'RATE_LIMIT', 'TIMEOUT']) test('temporary ' + code + ' retries but preserves the next valid denial', async () => {
  const h = harness([[{ type: 'finish', reason: { kind: 'error', failure: { code } } }], chunks(deny)]);
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 2);
  assert.equal(out.find(c => c.type === 'text-delta').text, deny);
  h.dispose();
});

test('explicit network cause retries at most twice and never leaks cause details', async () => {
  const error = new TypeError('PRIVATE_RAW_MESSAGE', { cause: Object.assign(new Error('private socket'), { code: 'ECONNRESET' }) });
  const h = harness([() => { throw error; }]);
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, 'REVIEW_CONNECTION_FAILURE');
  assert.equal(JSON.stringify([out, h.logs]).includes('PRIVATE_RAW_MESSAGE'), false);
  h.dispose();
});

test('unclassified exceptions and arbitrary error codes never trigger blind retry', async () => {
  for (const error of [new Error('network server temporary'), new TypeError('fetch failed'), Object.assign(new Error('private'), { code: 'PRIVATE_UNKNOWN_CODE' }), new ReviewFormatError('PRIVATE_UNKNOWN_CODE', 'private')]) {
    const h = harness([() => { throw error; }, chunks(deny)]);
    const out = await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(h.calls.length, 1);
    assert.equal(out[0].reason.failure.code, 'REVIEW_STREAM_FAILURE');
    assert.equal(JSON.stringify([out, h.logs]).includes('PRIVATE_UNKNOWN_CODE'), false);
    h.dispose();
  }
});

test('cause-chain cancellation wins over a known outer network error', () => {
  const error = Object.assign(new Error('private'), { code: 'ECONNRESET', cause: Object.assign(new Error(), { code: 'ABORT_ERR' }) });
  assert.equal(streamFailure(error).code, 'REVIEW_CANCELLED');
  assert.equal(streamFailure(error).retryable, false);
});

for (const makeRequest of [reviewRequest, orderedReviewRequest]) test(makeRequest.name + ': unsupported reasoning effort is final, safe and never downgraded', async () => {
  const reason = { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'PRIVATE_PROVIDER_TEXT', detail: 'PRIVATE_PARAMETERS' } };
  assert.equal(upstreamFailure(reason).retryable, false);
  let reads = 0, returns = 0;
  const h = harness([() => ({ [Symbol.asyncIterator]() { return {
    next() { reads++; return reads === 1 ? Promise.resolve({ done: false, value: { type: 'finish', reason } }) : new Promise(() => {}); },
    return() { returns++; return new Promise(() => {}); },
  }; } }), chunks(deny)], { firstContentTimeoutMs: 100 });
  const request = makeRequest({ reasoningEffort: 'max' });
  const original = JSON.stringify(request);
  try {
    const out = await collect(h.ctx.llm.stream(request));
    assert.equal(out.length, 1);
    assert.equal(out[0].reason.kind, 'error');
    assert.equal(out[0].reason.failure.code, 'REVIEW_UPSTREAM_UNSUPPORTED_REASONING_EFFORT');
    assert.match(out[0].reason.failure.message, /current review channel does not support the requested reasoning effort/);
    assert.match(out[0].reason.failure.message, /Adjust the call settings/);
    assert.match(out[0].reason.failure.message, /1:REVIEW_UPSTREAM_UNSUPPORTED_REASONING_EFFORT:\d+ms/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].reasoningEffort, 'max');
    assert.equal(JSON.stringify(request), original);
    assert.equal(h.calls[0].signal.aborted, true);
    assert.equal(reads, 1);
    assert.equal(returns, 1);
    assert.equal(JSON.stringify([out, h.logs]).includes('PRIVATE_'), false);
  } finally { h.dispose(); }
});
