import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { archivePath, nativeFixture, reviewRequest as legacyReviewRequest, orderedReviewRequest } from './host-fixture.mjs';
import { nativeReviewRequest, reinforceReviewRequest } from '../lib/protocol.js';
const guard = await import(process.env.REVIEW_GUARD_ENTRY
  ? pathToFileURL(process.env.REVIEW_GUARD_ENTRY).href
  : new URL('../lib/index.js', import.meta.url).href);

const host = suffix => pathToFileURL(archivePath + '/dsh/node_modules/@deepseek-ai/' + suffix).href;
const { Context } = await import(host('cordis/lib/index.js'));
const { BlockAssembler } = await import(host('dsh-llm/lib/index.js'));
const { readDecision } = nativeFixture(BlockAssembler);
const reviewRequest = nativeFixture(BlockAssembler).REVIEW_POLICY === legacyReviewRequest().system ? legacyReviewRequest : orderedReviewRequest;
assert.equal(nativeFixture(BlockAssembler).REVIEW_POLICY, reviewRequest().system, 'The installed native review policy differs from the supported snapshot.');
const renderer = nativeFixture(BlockAssembler).reviewMessages;
if (renderer) {
  const request = reviewRequest();
  request.messages = renderer({ cwd: 'D:/fictional-only', history: request.messages.slice(1).map(message => JSON.parse(message.content[0].text)) });
  assert.equal(nativeReviewRequest(request), true);
  assert.equal(reinforceReviewRequest(request).messages.at(-1), request.messages.at(-1));
  console.log('PASS actual host request renderer: recognized envelope and unchanged final pending call');
}
const allow = '{"risk":"low","decision":"allow"}';
const deny = '{"risk":"high","decision":"deny","reason":"Do not execute"}';
function response(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}
const ctx = new Context();
let backendCalls = 0;
let middlewareCalls = 0;
let responses = [];
let backendFactory;
const llm = { stream(request) {
  return ctx.waterfall('llm/stream', request, () => {
    if (backendFactory) { backendCalls++; return backendFactory(request); }
    const text = responses[Math.min(backendCalls++, responses.length - 1)];
    return (async function* () { yield* response(text); })();
  });
} };
ctx.provide('llm', llm);
// A real downstream listener must run again on every forwarded retry.
const stopDownstream = ctx.on('llm/stream', (_, next) => { middlewareCalls++; return next(); });
const fiber = ctx.plugin(guard, { retryDelayMs: 0 });
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(fiber.error, undefined);

responses = ['bad response', '```json\n' + deny + '\n```'];
const stream = llm.stream(reviewRequest());
assert.equal(typeof stream[Symbol.asyncIterator], 'function');
assert.equal(typeof stream.then, 'undefined');
const decision = await readDecision(stream);
assert.equal(decision.decision, 'deny');
assert.equal(backendCalls, 2);
assert.equal(middlewareCalls, 2);
console.log('PASS real Cordis: synchronous stream, retry chain, and native refusal parsing');

backendCalls = 0; middlewareCalls = 0;
responses = ['example ' + allow + '\nfinal ' + deny];
await assert.rejects(readDecision(llm.stream(reviewRequest())), /Review format guard/);
assert.equal(backendCalls, 3);
assert.equal(middlewareCalls, 3);
console.log('PASS real native parser: conflicting verdicts remain errors after exactly three attempts');

backendCalls = 0;
backendFactory = () => (async function* () {
  const delta = { type: 'text-delta', index: 0, text: deny };
  const end = { type: 'block-end', index: 0, block: { type: 'text', text: deny } };
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield delta;
  yield end;
  delta.text = allow;
  end.block.text = allow;
  yield { type: 'finish', reason: { kind: 'stop' } };
})();
const immutableDecision = await readDecision(llm.stream(reviewRequest()));
assert.equal(immutableDecision.decision, 'deny');
assert.equal(backendCalls, 1);
backendFactory = undefined;
console.log('PASS real native parser: reused mutable chunks cannot rewrite a received refusal');

backendCalls = 0;
responses = ['bad direct-route response', '```json\n' + allow + '\n```'];
assert.equal((await readDecision(llm.stream(reviewRequest({ provider: 'arbitrary-direct-provider', model: 'arbitrary-model' })))).decision, 'allow');
assert.equal(backendCalls, 2);
console.log('PASS real native parser: arbitrary model routes use format validation and retry');

backendCalls=0;
backendFactory=()=> (async function*(){
 yield {type:'block-start',index:0,blockType:'reasoning'};
 yield {type:'reasoning-delta',index:0,text:'Reasoning only.\n\n'};
 yield {type:'block-end',index:0,block:{type:'reasoning',text:'Reasoning only.'}};
 for(const c of response(deny))yield c.index===undefined?c:{...c,index:1};
})();
assert.equal((await readDecision(llm.stream(reviewRequest()))).decision,'deny');
assert.equal(backendCalls,1);
backendFactory=undefined;
console.log('PASS real native parser: reasoning whitespace repaired while refusal remains unchanged');

// Compare the guarded event stream with the installed assembler and parser,
// including normalization, metadata-bearing fragments and plain-delta merging.
for (const scenario of ['normalized metadata', 'trimmed block signatures', 'unchanged block signatures', 'reasoning-only repair', 'merged deltas']) {
  const raw = scenario === 'normalized metadata' ? '```json\n' + deny + '\n```'
    : scenario === 'trimmed block signatures' ? deny + ' \n' : deny;
  const fragments = scenario === 'trimmed block signatures' ? [deny, '', ' \n', '']
    : scenario === 'unchanged block signatures' ? [deny, '', ''] : Array.from(raw);
  const deltas = fragments.map((text, part) => ({
    type:'text-delta', index:1, text,
    ...(scenario === 'merged deltas' ? {} : {metadata:{part},signature:'original-' + part}),
  }));
  const input = [
    ...(scenario === 'reasoning-only repair' ? [
      {type:'reasoning-delta',index:0,text:'Analysis\n'},
      {type:'block-end',index:0,block:{type:'reasoning',text:'Analysis',signature:'old'}},
    ] : []),
    ...deltas,
    {type:'block-end',index:1,block:{type:'text',text:raw,metadata:{source:'adapter'},signature:'original-block'}},
    {type:'finish',reason:{kind:'stop'}},
  ];
  backendCalls = 0;
  backendFactory = () => (async function* () { yield* input; })();
  const output = [];
  for await (const chunk of llm.stream(reviewRequest())) output.push(chunk);
  const assembler = new BlockAssembler();
  for (const chunk of output) assembler.push(chunk);
  assert.equal(assembler.blocks().at(-1).text, deny);
  assert.equal((await readDecision((async function* () { yield* output; })())).decision,'deny');
  const actualDeltas = output.filter(c=>c.type==='text-delta');
  assert.equal(actualDeltas.map(c=>c.text).join(''),deny);
  if (scenario === 'normalized metadata' || scenario === 'trimmed block signatures') {
    assert.deepEqual(actualDeltas.map(c=>c.metadata),deltas.map(c=>c.metadata));
    assert.ok(actualDeltas.every(c=>!Object.hasOwn(c,'signature')));
    assert.equal(Object.hasOwn(assembler.blocks().at(-1),'signature'),false);
  } else if (scenario === 'reasoning-only repair' || scenario === 'unchanged block signatures') {
    assert.deepEqual(actualDeltas,deltas);
    assert.equal(assembler.blocks().at(-1).signature,'original-block');
  } else assert.equal(actualDeltas.length,1);
  assert.equal(backendCalls,1);
  console.log('PASS real native assembler and parser: ' + scenario);
}
backendFactory = undefined;


backendCalls = 0;
let failureReads = 0;
backendFactory = () => ({ [Symbol.asyncIterator]() { return {
  next() { failureReads++; return failureReads === 1
    ? Promise.resolve({done:false,value:{type:'finish',reason:{kind:'error',failure:{code:'CONTEXT_WINDOW_EXCEEDED',message:'PRIVATE'}}}})
    : new Promise(()=>{}); },
  return() { return new Promise(()=>{}); },
}; } });
await assert.rejects(readDecision(llm.stream(reviewRequest())), /context window/);
assert.equal(failureReads,1);
assert.equal(backendCalls,1);
backendFactory = undefined;
console.log('PASS native parser: failed finish stops immediately without iterator close');

// Native event-loop scheduling, real Cordis disposal and the native parser must
// all see cancellation before a fast microtask-only provider publishes a verdict.
let fastReads = 0, fastClosed = false;
backendFactory = () => (async function* () {
  try {
    for (let i = 0; i < 50000; i++) {
      fastReads++;
      yield { type: 'reasoning-delta', index: 0, text: 'x' };
    }
    for (const c of response(deny)) yield c.index === undefined ? c : { ...c, index: 1 };
  } finally { fastClosed = true; }
})();
backendCalls = 0;
const fastController = new AbortController();
const cancelTimer = setTimeout(() => fastController.abort(), 5);
try {
  await assert.rejects(readDecision(llm.stream(reviewRequest({ signal: fastController.signal }))));
  assert.ok(fastReads > 0 && fastReads < 50000);
  assert.equal(fastClosed, true);
  assert.equal(backendCalls, 1);
} finally { clearTimeout(cancelTimer); }
console.log('PASS real native parser: timer cancellation interrupts fast source without retry or verdict');

backendCalls = 0; fastReads = 0; fastClosed = false;
let disposal;
const unloadTimer = setTimeout(() => { disposal = fiber.dispose(); }, 5);
try {
  await assert.rejects(readDecision(llm.stream(reviewRequest())));
  await disposal;
  assert.ok(fastReads > 0 && fastReads < 50000);
  assert.equal(fastClosed, true);
  assert.equal(backendCalls, 1);
} finally { clearTimeout(unloadTimer); await fiber.dispose(); }
backendFactory = undefined;
console.log('PASS real Cordis: timer unload interrupts fast source without retry or verdict');

backendCalls = 0; responses = ['unmodified content'];
const after = [];
for await (const chunk of llm.stream(reviewRequest())) after.push(chunk);
assert.equal(backendCalls, 1);
assert.equal(after[1].text, 'unmodified content');
console.log('PASS real Cordis: unloading removes the plugin and restores original forwarding');
const reloaded = ctx.plugin(guard, { retryDelayMs: 0 });
await new Promise(resolve => setTimeout(resolve, 20));
backendCalls = 0; responses = [allow];
assert.equal((await readDecision(llm.stream(reviewRequest()))).decision, 'allow');
assert.equal(backendCalls, 1);
await reloaded.dispose();
console.log('PASS real Cordis: re-enabling registers exactly one listener and forwards one request');
stopDownstream();
