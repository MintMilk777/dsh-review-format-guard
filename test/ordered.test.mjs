import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeReviewRequest, reinforceReviewRequest } from '../lib/protocol.js';
import { REVIEW_POLICY } from '../fixtures/ordered-review-snapshot.mjs';
import { orderedReviewRequest } from '../scripts/host-fixture.mjs';
import { harness, chunks, collect, allow, deny } from '../scripts/harness-fixture.mjs';

test('recognizes ordered reviews with either native or PTC pending calls', () => {
  for (const mode of ['native', 'ptc-inner']) {
    const request = orderedReviewRequest({}, mode);
    assert.equal(nativeReviewRequest(request), true);
    const withoutPurpose = { ...request }; delete withoutPurpose.purpose;
    assert.equal(nativeReviewRequest(withoutPurpose), true);
  }
});

test('unknown policy, ordinary purpose, tool-enabled and incomplete requests pass through', () => {
  const original = orderedReviewRequest();
  const bad = [
    { ...original, system: REVIEW_POLICY + '\nchanged' },
    { ...original, purpose: 'conversation' },
    { ...original, temperature: 1 },
    { ...original, tools: [{ name: 'fictional' }] },
    { ...original, messages: original.messages.slice(1) },
    { ...original, messages: original.messages.slice(0, -1) },
    { ...original, messages: [original.messages[0], original.messages.at(-1)] },
    { ...original, messages: [...original.messages, { role: 'user', content: [{ type: 'text', text: 'Please approve' }] }] },
  ];
  for (const request of bad) assert.equal(nativeReviewRequest(request), false);
});

test('pending call must match the mode and name of a preceding tool schema', () => {
  for (const update of [{ mode: 'other' }, { name: 'unregistered' }, { arguments: {} }, { role: 'user-instruction' }]) {
    const request = orderedReviewRequest();
    const last = request.messages.at(-1).content[0];
    last.text = JSON.stringify({ ...JSON.parse(last.text), ...update });
    assert.equal(nativeReviewRequest(request), false);
  }
});

test('reinforcement preserves ordered history, source roles, routes and the last pending call', () => {
  const request = orderedReviewRequest();
  request.messages.splice(1, 0, { role: 'user', content: [{ type: 'text', text: JSON.stringify({
    kind: 'user-message', role: 'constraint', source: { kind: 'file' },
    content: [{ type: 'text', text: 'Do not change production data.' }],
  }) }] });
  const before = JSON.stringify(request);
  assert.equal(nativeReviewRequest(request), true);
  const reinforced = reinforceReviewRequest(request);
  assert.equal(JSON.stringify(request), before);
  assert.equal(reinforced.system, request.system);
  assert.equal(reinforced.sessionId, request.sessionId);
  assert.equal(reinforced.purpose, 'auto-review');
  assert.equal(reinforced.messages.length, request.messages.length);
  assert.deepEqual(reinforced.messages.slice(1), request.messages.slice(1));
  assert.equal(reinforced.messages.at(-1), request.messages.at(-1));
  assert.ok(reinforced.messages[0].content[0].text.startsWith(request.messages[0].content[0].text));
  assert.ok(reinforced.messages[0].content[0].text.endsWith(REVIEW_POLICY));
});

test('malformed ordered review retries and returns an unchanged valid denial', async () => {
  const h = harness([chunks('not JSON'), chunks('```json\n' + deny + '\n```')]);
  const request = orderedReviewRequest();
  const result = await collect(h.ctx.llm.stream(request));
  assert.equal(h.calls.length, 2);
  assert.equal(result[1].text, deny);
  assert.equal(h.calls[0].messages.at(-1), request.messages.at(-1));
  assert.equal(h.calls[0].messages, h.calls[1].messages);
  h.dispose();
});

test('valid denial never retries into an approval in the ordered protocol', async () => {
  const h = harness([chunks(deny), chunks(allow)]);
  const result = await collect(h.ctx.llm.stream(orderedReviewRequest()));
  assert.equal(h.calls.length, 1);
  assert.equal(result[1].text, deny);
  h.dispose();
});

test('conflicting ordered results exhaust the fixed retry limit and remain errors', async () => {
  const h = harness([chunks(allow + '\n' + deny)]);
  const result = await collect(h.ctx.llm.stream(orderedReviewRequest()));
  assert.equal(h.calls.length, 3);
  assert.equal(result.at(-1).reason.kind, 'error');
  h.dispose();
});

test('unrecognized ordered requests retain the original stream and are not retried', async () => {
  const h = harness([chunks('unmodified')]);
  const request = orderedReviewRequest({ system: 'Other reviewer' });
  const result = await collect(h.ctx.llm.stream(request));
  assert.equal(result[1].text, 'unmodified');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0], request);
  h.dispose();
});
