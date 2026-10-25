import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { archivePath, nativeFixture, reviewRequest } from './host-fixture.mjs';
const guard = await import(process.env.REVIEW_GUARD_ENTRY
  ? pathToFileURL(process.env.REVIEW_GUARD_ENTRY).href
  : new URL('../lib/index.js', import.meta.url).href);

const host = suffix => pathToFileURL(archivePath + '/dsh/node_modules/@deepseek-ai/' + suffix).href;
const { Context } = await import(host('cordis/lib/index.js'));
const { BlockAssembler } = await import(host('dsh-llm/lib/index.js'));
const { readDecision } = nativeFixture(BlockAssembler);
assert.equal(nativeFixture(BlockAssembler).REVIEW_POLICY, reviewRequest().system, 'The installed native review policy differs from the supported snapshot.');
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

await fiber.dispose();
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
