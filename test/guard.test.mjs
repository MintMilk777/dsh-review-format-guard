import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, resolveOptions } from '../lib/index.js';
import { nativeReviewRequest, normalizeDecision, reinforceReviewRequest, validateDecision } from '../lib/protocol.js';
import { inspectReviewChunks, normalizedChunks } from '../lib/stream.js';
import { reviewRequest, nativeFixture } from '../scripts/host-fixture.mjs';

const allow = '{"risk":"low","decision":"allow"}';
const deny = '{"risk":"high","decision":"deny","reason":"Explicit refusal"}';
const fence = text => '```json\n' + text + '\n```';
function chunks(text = allow) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}
async function* stream(items) { yield* items; }
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }

// Match Cordis's consuming waterfall, including its non-reusable next callback.
function harness(responses, config = {}) {
  let listeners = [];
  const cleanups = [];
  const calls = [];
  const logs = [];
  const ctx = {
    logger: { info: line => logs.push(line), warn: line => logs.push(line) },
    effect(factory) { cleanups.push(factory()); },
    on(event, handler, options) {
      assert.equal(event, 'llm/stream');
      options?.prepend ? listeners.unshift(handler) : listeners.push(handler);
      cleanups.push(() => { listeners = listeners.filter(listener => listener !== handler); });
    },
    llm: { stream(request) {
      const chain = [...listeners];
      const terminal = () => {
        const index = calls.push(request) - 1;
        const response = responses[Math.min(index, responses.length - 1)];
        return typeof response === 'function' ? response(request) : stream(response);
      };
      const next = () => (chain.shift() ?? terminal)(request, next);
      return next();
    } },
  };
  apply(ctx, { retryDelayMs: 0, ...config });
  return { ctx, calls, logs, dispose() { for (const cleanup of cleanups.reverse()) cleanup?.(); } };
}

test('recognizes only the exact native policy and expected request envelope', () => {
  assert.equal(nativeReviewRequest(reviewRequest()), true);
  assert.equal(nativeReviewRequest(reviewRequest({ system: 'Please return JSON' })), false);
  assert.equal(nativeReviewRequest(reviewRequest({ system: reviewRequest().system + '\nchanged' })), false);
  assert.equal(nativeReviewRequest(reviewRequest({ temperature: 1 })), false);
  assert.equal(nativeReviewRequest(reviewRequest({ tools: [{ name: 'bash' }] })), false);
  assert.equal(nativeReviewRequest(reviewRequest({ messages: [] })), false);
});

for (const raw of [allow, deny, '{"risk":"medium","decision":"allow"}', '{"risk":"medium","decision":"deny"}']) {
  test('valid verdict stays valid in the real native parser: ' + raw, () => {
    const result = normalizeDecision(raw);
    assert.equal(result.text, raw);
    assert.equal(result.changed, false);
    assert.equal(JSON.stringify(nativeFixture().parseDecision(result.text)), JSON.stringify(result.decision));
  });
}
test('only whole JSON fences, whitespace and an initial BOM are cleaned', () => {
  for (const raw of [fence(allow), '\uFEFF' + allow, ' \n' + allow + '\r\n', '```\r\n' + deny + '\r\n```']) {
    const result = normalizeDecision(raw);
    assert.equal(result.text, raw.includes('deny') ? deny : allow);
    assert.equal(result.changed, true);
  }
});
for (const raw of [
  '', '收到。我现在调用工具', '<｜｜DSML｜｜ calls>' + allow,
  '<tool_call>' + allow + '</tool_call>', '示例 ' + allow + '\n最终结论 ' + deny,
  allow + '\n' + deny, fence(allow) + '\n' + fence(deny),
  '{"risk":"high","decision":"allow"}', '{"risk":"low","decision":"deny"}',
  '{"risk":"low","decision":"allow","reason":"extra"}',
  '{"risk":"low","decision":"deny","decision":"allow"}',
  '{"risk":"low","decision":"deny","decisi\\u006fn":"allow"}',
  '{"risk":"low","decision":"allow",}', '[{"risk":"low","decision":"allow"}]',
]) {
  test('rejects malformed, conflicting or invented verdict: ' + raw.slice(0, 80), () => {
    assert.throws(() => normalizeDecision(raw));
  });
}
test('JSON strings containing colons, braces and escaped quotes are not duplicate members', () => {
  const raw = JSON.stringify({ risk: 'high', decision: 'deny', reason: 'Example: {"risk":"low"}; keep refusal' });
  assert.equal(validateDecision(raw).decision, 'deny');
});
test('updates both delta and finalized text and clears stale replay metadata', () => {
  const input = chunks(fence(allow));
  input.at(-1).replayState = { response: { opaque: true } };
  const result = normalizedChunks(input, inspectReviewChunks(input));
  assert.equal(result[1].text, allow);
  assert.equal(result[2].block.text, allow);
  assert.equal('replayState' in result.at(-1), false);
  assert.equal(input[1].text, fence(allow));
});
test('split deltas, reasoning and delta-only protocols are supported', () => {
  const input = [
    { type: 'reasoning-delta', index: 0, text: 'consider effects' },
    ...allow.match(/.{1,3}/g).map(text => ({ type: 'text-delta', index: 1, text })),
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  assert.equal(inspectReviewChunks(input).text, allow);
});
test('conflicting deltas and completed text are rejected, even if one says allow', () => {
  const input = chunks(allow);
  input[2].block.text = deny;
  assert.throws(() => inspectReviewChunks(input), { code: 'REVIEW_STREAM_INVALID' });
});
test('rejects action blocks, missing finish, data after finish and multiple conclusions', () => {
  for (const input of [
    [{ type: 'block-start', index: 0, blockType: 'tool-call' }, ...chunks()],
    chunks().slice(0, -1), [...chunks(), { type: 'text-delta', index: 0, text: 'late' }],
    [...chunks().slice(0, -1), { type: 'text-delta', index: 1, text: deny }, chunks().at(-1)],
  ]) assert.throws(() => inspectReviewChunks(input));
});
test('malformed response retries original request and then accepts a valid verdict', async () => {
  const h = harness([chunks('invalid'), chunks(fence(deny))]);
  const request = Object.freeze(reviewRequest());
  const result = await collect(h.ctx.llm.stream(request));
  assert.equal(h.calls.length, 2);
  assert.equal(result[1].text, deny);
  assert.ok(h.calls[0].messages[0].content[0].text.startsWith(request.messages[0].content[0].text + '\n\nREVIEW_POLICY_CONFIRMATION\n'));
  assert.equal(h.calls[0].messages, h.calls[1].messages);
  assert.equal(h.calls[1].system, request.system);
  assert.equal(h.calls[1].provider, request.provider);
  assert.equal(Object.hasOwn(request, 'signal'), false);
  assert.equal(h.logs.some(line => line.includes('invalid') || line.includes('Explicit refusal')), false);
});
test('request reinforcement preserves the full native policy and data without mutating input', () => {
  const request = reviewRequest();
  const before = JSON.stringify(request);
  const reinforced = reinforceReviewRequest(request);
  assert.equal(JSON.stringify(request), before);
  assert.equal(reinforced.system, request.system);
  assert.equal(reinforced.model, request.model);
  assert.equal(reinforced.provider, request.provider);
  const inputText = request.messages[0].content[0].text;
  assert.ok(reinforced.messages[0].content[0].text.startsWith(inputText));
  assert.ok(reinforced.messages[0].content[0].text.includes('\nREVIEW_POLICY\n'));
  assert.ok(reinforced.messages[0].content[0].text.includes('High must always be denied'));
  assert.equal(Object.isFrozen(reinforced.messages[0].content[0]), true);
  assert.throws(() => reinforceReviewRequest(reviewRequest({ system: 'ordinary chat' })));
});
test('three bad responses terminate in failure, never fabricate allow or deny', async () => {
  const h = harness([chunks('example ' + allow + ' final ' + deny)]);
  const result = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'finish');
  assert.equal(result[0].reason.kind, 'error');
  assert.match(result[0].reason.failure.message, /after 3 attempt/);
  assert.match(result[0].reason.failure.message, /shape=prose-or-other-text/);
});
test('explicit valid refusal is never retried', async () => {
  const h = harness([chunks(deny), chunks(allow)]);
  assert.equal((await collect(h.ctx.llm.stream(reviewRequest())))[1].text, deny);
  assert.equal(h.calls.length, 1);
});
test('upstream rate limit retries but authentication errors do not', async () => {
  for (const [code, expected] of [['RATE_LIMIT', 2], ['AUTH', 1]]) {
    const h = harness([[{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'private provider details' } } }], chunks()]);
    const result = await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(h.calls.length, expected);
    assert.equal(JSON.stringify(result).includes('private provider details'), false);
  }
});
test('ordinary chat and explicitly excluded providers pass through with original request and chunks', async () => {
  for (const request of [reviewRequest({ system: 'ordinary chat' }), reviewRequest({ provider: 'unrelated' })]) {
    const input = chunks('unrestricted ordinary content');
    const h = harness([input], { providerIds: ['fixture-provider'] });
    const result = await collect(h.ctx.llm.stream(request));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0], request);
    assert.equal(result[0], input[0]);
  }
});
test('cancelled requests neither dispatch nor retry', async () => {
  const controller = new AbortController(); controller.abort();
  const h = harness([chunks()]);
  const result = await collect(h.ctx.llm.stream(reviewRequest({ signal: controller.signal })));
  assert.equal(h.calls.length, 0);
  assert.equal(result[0].reason.kind, 'aborted');
});
test('unload cancels an in-flight review and restores passthrough', async () => {
  const h = harness([request => (async function* () {
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
  })()]);
  const pending = collect(h.ctx.llm.stream(reviewRequest()));
  await new Promise(resolve => setTimeout(resolve, 5));
  h.dispose();
  assert.equal((await pending)[0].reason.kind, 'aborted');
  assert.equal(h.calls.length, 1);
});
test('attempt timeout retries exactly twice and aborts each attempt', async () => {
  const h = harness([request => (async function* () {
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
  })()], { timeoutMs: 5 });
  const result = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 3);
  assert.equal(result[0].reason.failure.code, 'REVIEW_TIMEOUT');
  assert.equal(h.calls.every(request => request.signal.aborted), true);
});
test('oversized review is not forwarded as a successful response', async () => {
  const h = harness([chunks('x'.repeat(2000))], { maxBytes: 1024, retries: 0 });
  const result = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(result.length, 1);
  assert.equal(result[0].reason.failure.code, 'REVIEW_SIZE_LIMIT');
});
test('unsupported plugin options fail instead of silently broadening scope', () => {
  assert.throws(() => resolveOptions({ retries: 99 }));
  assert.deepEqual(resolveOptions().providerIds, []);
  assert.throws(() => resolveOptions({ providerIds: [' '] }));
  assert.throws(() => resolveOptions({ unknown: true }));
});
