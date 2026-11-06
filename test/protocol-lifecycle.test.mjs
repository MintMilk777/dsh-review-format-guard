import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRequest, orderedReviewRequest, nativeFixture } from '../scripts/host-fixture.mjs';
import { harness, chunks, stream, collect, allow, deny } from '../scripts/harness-fixture.mjs';
import { inspectReviewChunks } from '../lib/stream.js';

const finishError = code => [{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'Private diagnostic text must not leak' } } }];
const malformed = {
  'truncated JSON': chunks('{"risk":"low"'),
  'duplicate decision members': chunks('{"risk":"medium","decision":"deny","decision":"allow"}'),
  'tool-call markup': chunks('<tool_call>' + allow + '</tool_call>'),
  'missing terminal finish': chunks(allow).slice(0, -1),
  'conflicting final snapshot': chunks(deny).map(chunk => chunk.type === 'block-end' ? { ...chunk, block: { type: 'text', text: allow } } : chunk),
};
for (const [label, response] of Object.entries(malformed)) {
  test('ordered protocol retries ' + label + ' without releasing its provisional text', async () => {
    const h = harness([response, chunks(deny)]);
    const out = await collect(h.ctx.llm.stream(orderedReviewRequest()));
    assert.equal(h.calls.length, 2);
    assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
    assert.equal(JSON.stringify(out).includes('Private diagnostic'), false);
    assert.equal(JSON.stringify(nativeFixture().parseDecision(inspectReviewChunks(out).text)), JSON.stringify(inspectReviewChunks(out).decision));
    h.dispose();
  });
}
for (const code of ['RATE_LIMIT', 'SERVER', 'TRANSPORT', 'AUTH', 'INVALID_REQUEST']) {
  test('ordered protocol applies the correct retry and disclosure rules for ' + code, async () => {
    const h = harness([finishError(code), chunks(deny)]);
    const out = await collect(h.ctx.llm.stream(orderedReviewRequest()));
    const retry = ['RATE_LIMIT', 'SERVER', 'TRANSPORT'].includes(code);
    assert.equal(h.calls.length, retry ? 2 : 1);
    if (retry) assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
    else assert.equal(out.at(-1).reason.kind, 'error');
    assert.equal(JSON.stringify(out).includes('Private diagnostic text'), false);
    assert.equal(h.logs.some(line => line.includes('Private diagnostic text')), false);
    h.dispose();
  });
}
test('ordered requests cannot release a provisional approval before the stream finishes', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const h = harness([() => (async function* () {
    yield { type: 'text-delta', index: 0, text: allow };
    await ready;
    yield { type: 'text-delta', index: 0, text: '\n' + deny };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })()], { retries: 0 });
  let delivered = false;
  const pending = collect(h.ctx.llm.stream(orderedReviewRequest())).then(value => { delivered = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(delivered, false);
  release();
  const out = await pending;
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.kind, 'error');
  h.dispose();
});
test('legacy and ordered concurrent calls have separate decisions and retry budgets', async () => {
  const counts = new Map();
  const h = harness([request => {
    const id = Number(request.model.slice(5));
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    return stream(chunks(id % 3 === 0 && count === 1 ? 'malformed' : id % 2 ? deny : allow));
  }]);
  const out = await Promise.all(Array.from({ length: 24 }, (_, id) => collect(h.ctx.llm.stream((id % 2 ? reviewRequest : orderedReviewRequest)({ model: 'case-' + id })))));
  for (let id = 0; id < out.length; id++) {
    assert.equal(inspectReviewChunks(out[id]).decision.decision, id % 2 ? 'deny' : 'allow');
    assert.equal(counts.get(id), id % 3 === 0 ? 2 : 1);
  }
  h.dispose();
});
test('ordered cancellation during backoff prevents further dispatch', async () => {
  const controller = new AbortController();
  const h = harness([chunks('bad')], { retryDelayMs: 100 });
  const pending = collect(h.ctx.llm.stream(orderedReviewRequest({ signal: controller.signal })));
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  assert.equal((await pending).at(-1).reason.kind, 'aborted');
  assert.equal(h.calls.length, 1);
  h.dispose();
});
test('ordered timeout exhausts only its configured attempt budget', async () => {
  const h = harness([request => (async function* () {
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
  })()], { timeoutMs: 10 });
  const out = await collect(h.ctx.llm.stream(orderedReviewRequest()));
  assert.equal(h.calls.length, 3);
  assert.equal(out[0].reason.kind, 'error');
  assert.match(out[0].reason.failure.code, /TIMEOUT/);
  h.dispose();
});
test('unloading cancels an ordered request without cancelling an unrelated host request', async () => {
  const h = harness([request => request.model === 'normal-chat' ? stream(chunks('ordinary reply')) : (async function* () {
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
  })()]);
  const pending = collect(h.ctx.llm.stream(orderedReviewRequest()));
  const normal = collect(h.ctx.llm.stream(orderedReviewRequest({ model: 'normal-chat', system: 'Ordinary chat' })));
  h.dispose();
  assert.equal((await pending).at(-1).reason.kind, 'aborted');
  assert.equal((await normal)[1].text, 'ordinary reply');
});
test('ordered oversized output remains an error without exposing text', async () => {
  const h = harness([chunks('x'.repeat(2000))], { maxBytes: 1024 });
  const out = await collect(h.ctx.llm.stream(orderedReviewRequest()));
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.kind, 'error');
  h.dispose();
});
test('ordered provider exclusion and disabled guard preserve exact original requests', async () => {
  for (const config of [{ enabled: false }, { providerIds: ['another-provider'] }]) {
    const h = harness([chunks('unmodified')], config);
    const request = orderedReviewRequest();
    assert.equal((await collect(h.ctx.llm.stream(request)))[1].text, 'unmodified');
    assert.equal(h.calls[0], request);
    assert.equal(h.calls.length, 1);
    h.dispose();
  }
});
