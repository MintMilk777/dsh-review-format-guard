import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRequest, nativeFixture } from '../scripts/host-fixture.mjs';
import { normalizeDecision, nativeReviewRequest } from '../lib/protocol.js';
import { inspectReviewChunks } from '../lib/stream.js';
import { allow, deny, chunks, stream, collect, harness } from '../scripts/harness-fixture.mjs';

test('verdict acceptance agrees with the host across a full field/type matrix', () => {
  const native = nativeFixture().parseDecision;
  const risks = ['low', 'medium', 'high', 'LOW', null, 0, true, {}, []];
  const decisions = ['allow', 'deny', 'ALLOW', null, 0, false, {}];
  const reasons = [undefined, '', 'No: {unsafe} "quoted"', 0, null, {}, []];
  for (const risk of risks) for (const decision of decisions) for (const reason of reasons) for (const extra of [false, true]) {
    const value = { risk, decision, ...(reason === undefined ? {} : { reason }), ...(extra ? { extra: true } : {}) };
    const raw = JSON.stringify(value);
    let expected;
    try { expected = JSON.stringify(native(raw)); } catch {}
    let actual;
    try { actual = JSON.stringify(normalizeDecision(raw).decision); } catch {}
    assert.equal(actual, expected, raw);
  }
});

test('deterministic malformed-input corpus never introduces a verdict the native parser rejects', () => {
  const native = nativeFixture().parseDecision;
  const base = [allow, deny, '{"risk":"medium","decision":"allow"}', '{"risk":"medium","decision":"deny"}'];
  let seed = 0x12345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const chars = ['"', '{', '}', ',', ':', '\\', '\u0000', '[', ']', 'x', '\n', ' '];
  for (let i = 0; i < 2000; i++) {
    const raw = base[random() % base.length];
    const at = random() % (raw.length + 1);
    const candidate = raw.slice(0, at) + chars[random() % chars.length] + raw.slice(at + (random() % 2));
    let accepted;
    try { accepted = normalizeDecision(candidate); } catch { continue; }
    assert.equal(JSON.stringify(native(accepted.text)), JSON.stringify(accepted.decision));
    assert.notDeepEqual(accepted.decision, { risk: 'high', decision: 'allow' });
  }
});

test('buffers immutable observations when a provider reuses its chunk objects', async () => {
  const delta = { type: 'text-delta', index: 0, text: deny };
  const end = { type: 'block-end', index: 0, block: { type: 'text', text: deny } };
  const h = harness([() => (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield delta;
    yield end;
    delta.text = allow;
    end.block.text = allow;
    yield { type: 'finish', reason: { kind: 'stop' } };
  })()], { retries: 0 });
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
});

test('releases no text while the provider has not finished validation', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  let received = false;
  const h = harness([() => (async function* () {
    yield { type: 'text-delta', index: 0, text: allow };
    await ready;
    yield { type: 'finish', reason: { kind: 'stop' } };
  })()]);
  const iterator = h.ctx.llm.stream(reviewRequest())[Symbol.asyncIterator]();
  const pending = iterator.next().then(value => { received = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(received, false);
  release();
  assert.equal((await pending).value.type, 'text-delta');
  await iterator.return();
  h.dispose();
});

test('concurrent requests retain independent retry budgets and conclusions', async () => {
  const counts = new Map();
  const h = harness([request => {
    const id = Number(request.model.slice(5));
    const seen = (counts.get(id) ?? 0) + 1;
    counts.set(id, seen);
    return (async function* () {
      await new Promise(resolve => setTimeout(resolve, id % 3));
      yield* chunks(id % 2 && seen === 1 ? 'bad' : id % 2 ? deny : allow);
    })();
  }]);
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_, id) => collect(h.ctx.llm.stream(reviewRequest({ model: 'case-' + id })))));
  for (let id = 0; id < outcomes.length; id++) {
    assert.equal(inspectReviewChunks(outcomes[id]).decision.decision, id % 2 ? 'deny' : 'allow');
    assert.equal(counts.get(id), id % 2 ? 2 : 1);
  }
});

test('cancelling one request does not cancel another concurrent request', async () => {
  const controller = new AbortController();
  const h = harness([request => request.model === 'cancel' ? (async function* () {
    await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
  })() : stream(chunks())]);
  const cancelled = collect(h.ctx.llm.stream(reviewRequest({ model: 'cancel', signal: controller.signal })));
  const ok = collect(h.ctx.llm.stream(reviewRequest({ model: 'ok' })));
  controller.abort();
  assert.equal((await cancelled).at(-1).reason.kind, 'aborted');
  assert.equal(inspectReviewChunks(await ok).decision.decision, 'allow');
});

test('cancellation during retry backoff prevents a second dispatch', async () => {
  const controller = new AbortController();
  const h = harness([chunks('bad')], { retryDelayMs: 100 });
  const pending = collect(h.ctx.llm.stream(reviewRequest({ signal: controller.signal })));
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  const out = await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(out[0].reason.kind, 'aborted');
});

test('disable and unload both restore exact original forwarding', async () => {
  const request = reviewRequest();
  const disabled = harness([chunks('not JSON')], { enabled: false });
  assert.equal((await collect(disabled.ctx.llm.stream(request)))[1].text, 'not JSON');
  assert.equal(disabled.calls[0], request);
  const unloaded = harness([chunks('not JSON')]);
  unloaded.dispose();
  assert.equal((await collect(unloaded.ctx.llm.stream(request)))[1].text, 'not JSON');
  assert.equal(unloaded.calls[0], request);
});

test('unknown policy versions and third-party review prompts are not modified', async () => {
  for (const request of [reviewRequest({ system: reviewRequest().system + '\nnew version' }), reviewRequest({ system: 'Third party auto review; return JSON' })]) {
    assert.equal(nativeReviewRequest(request), false);
    const h = harness([chunks('original text')]);
    await collect(h.ctx.llm.stream(request));
    assert.equal(h.calls[0], request);
    assert.equal(h.calls.length, 1);
  }
});

test('arbitrary provider and model names receive the same guarded native review handling', async () => {
  for (const provider of ['fixture-direct', 'fixture-vision', 'openai-like', 'anthropic-like', 'gemini-like', 'arbitrary-new-provider']) {
    const h = harness([chunks('bad'), chunks(deny)]);
    const request = reviewRequest({ provider, model: 'arbitrary-new-model' });
    const out = await collect(h.ctx.llm.stream(request));
    assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls.every(call => call.provider === provider), true);
  }
});

test('rejects malformed providers without releasing a successful conclusion', async () => {
  const cases = [
    () => Promise.resolve(stream(chunks())),
    () => ({ [Symbol.asyncIterator]() { throw new Error('private error'); } }),
    () => (async function* () { throw new Error('private error'); })(),
    () => (async function* () { yield null; })(),
  ];
  for (const response of cases) {
    const h = harness([response], { retries: 0 });
    const out = await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'finish');
    assert.equal(out[0].reason.kind, 'error');
    assert.equal(JSON.stringify(out).includes('private error'), false);
  }
});

test('empty, truncated, tool-call finishes and chunk floods remain failures', async () => {
  const cases = [
    [], chunks('').slice(0, -1),
    [{ type: 'finish', reason: { kind: 'tool-calls' } }],
    [...Array.from({ length: 20 }, () => ({ type: 'usage', usage: {} })), ...chunks()],
  ];
  for (const response of cases) {
    const h = harness([response], { retries: 0, maxChunks: 8 });
    const out = await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(out.length, 1);
    assert.equal(out[0].reason.kind, 'error');
  }
});


test('repairs only peripheral whitespace in reasoning snapshots and discards stale replay state', async () => {
  const input=[
    {type:'block-start',index:0,blockType:'reasoning'},
    {type:'reasoning-delta',index:0,text:'Reasoning only.\n\n'},
    {type:'block-end',index:0,block:{type:'reasoning',text:'Reasoning only.',signature:'stale'}},
    ...chunks(deny).map(c=>c.index===undefined?{...c,replayState:{stale:true}}:{...c,index:1}),
  ];
  const original=JSON.stringify(input), h=harness([input]);
  const out=await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length,1);
  assert.equal(inspectReviewChunks(out).decision.decision,'deny');
  assert.equal(out.find(c=>c.type==='block-end').block.text,'Reasoning only.\n\n');
  assert.equal(JSON.stringify(out).includes('stale'),false);
  assert.equal(JSON.stringify(input),original);
});

test('substantive reasoning changes and all verdict delta conflicts still fail closed', async () => {
  const reasoning=[
    {type:'block-start',index:0,blockType:'reasoning'},
    {type:'reasoning-delta',index:0,text:'First reasoning'},
    {type:'block-end',index:0,block:{type:'reasoning',text:'Different reasoning'}},
    ...chunks(deny).map(c=>c.index===undefined?c:{...c,index:1}),
  ];
  const text=chunks(deny);text[2]={...text[2],block:{type:'text',text:' '+deny+' '}};
  for(const invalid of [reasoning,text]){
    const h=harness([invalid]);const out=await collect(h.ctx.llm.stream(reviewRequest()));
    assert.equal(h.calls.length,3);
    assert.equal(out.some(c=>c.type==='text-delta'),false);
    assert.equal(out.at(-1).reason.kind,'error');
  }
});


test('native SERVER and TRANSPORT errors retry within the same bound, while AUTH and INVALID_REQUEST do not', async () => {
 for(const code of ['SERVER','TRANSPORT','AUTH','INVALID_REQUEST']){
  const h=harness([[{type:'finish',reason:{kind:'error',failure:{code,message:'Private upstream message'}}}],chunks(deny)]);
  const out=await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length,['SERVER','TRANSPORT'].includes(code)?2:1);
  if(h.calls.length===2)assert.equal(inspectReviewChunks(out).decision.decision,'deny');
  else assert.equal(out.at(-1).reason.kind,'error');
  assert.equal(JSON.stringify(out).includes('Private upstream message'),false);
 }
});
