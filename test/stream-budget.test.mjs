import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions } from '../lib/index.js';
import { collectReviewStream, inspectReviewChunks } from '../lib/stream.js';
import { ReviewFormatError } from '../lib/protocol.js';
import { harness, chunks, collect, deny } from '../scripts/harness-fixture.mjs';
import { reviewRequest } from '../scripts/host-fixture.mjs';

async function buffer(items, options = {}) {
  return collectReviewStream((async function* () { yield* items; })(), new AbortController().signal, resolveOptions(options));
}
function reasoning(text, size = 1) {
  const out = [{ type: 'block-start', index: 0, blockType: 'reasoning' }];
  for (let i = 0; i < text.length; i += size) out.push({ type: 'reasoning-delta', index: 0, text: text.slice(i, i + size) });
  out.push({ type: 'block-end', index: 0, block: { type: 'reasoning', text } });
  return [...out, ...chunks(deny).map(c => c.index === undefined ? c : { ...c, index: 1 })];
}

for (const [name, prefix, code] of [
  ['failed finish', [{ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'SECRET' } } }], 'REVIEW_UPSTREAM_CONTEXT_WINDOW_EXCEEDED'],
  ['invalid block', [{ type: 'block-start', index: 0, blockType: 'tool-call' }], 'REVIEW_STREAM_INVALID'],
  ['conflicting snapshot', [{ type: 'text-delta', index: 0, text: deny }, { type: 'block-end', index: 0, block: { type: 'text', text: 'different' } }], 'REVIEW_STREAM_INVALID'],
  ['event after stop', [...chunks(deny), { type: 'usage', usage: {} }], 'REVIEW_STREAM_INVALID'],
]) test(name + ' terminates without another next or waiting for return', async () => {
  let reads = 0, returns = 0;
  const stream = { [Symbol.asyncIterator]() { return {
    next() { const value = prefix[reads++]; return value ? Promise.resolve({ value, done: false }) : new Promise(() => {}); },
    return() { returns++; return new Promise(() => {}); },
  }; } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try { await assert.rejects(collectReviewStream(stream, controller.signal, resolveOptions()), { code }); }
  finally { clearTimeout(timer); }
  assert.equal(reads, prefix.length);
  assert.equal(returns, 1);
});

test('18380-byte measured sample envelope passes character and 1024 splits without dropping snapshots or replay', async () => {
  const text = 'r'.repeat(18380);
  for (const size of [1, 8, 64, 1024]) {
    const input = reasoning(text, size);
    input.at(-1).replayState = { opaque: 'retain-exactly' };
    const out = await buffer(input);
    assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
    assert.equal(out.filter(c => c.type === 'reasoning-delta').map(c => c.text).join(''), text);
    assert.deepEqual(out.filter(c => c.type === 'block-end'), input.filter(c => c.type === 'block-end'));
    assert.deepEqual(out.at(-1), input.at(-1));
    assert.ok(out.length < 20);
  }
});

test('merge never crosses usage, index, type or adapter metadata boundaries', async () => {
  const input = [
    { type: 'reasoning-delta', index: 0, text: 'a' },
    { type: 'usage', usage: {} },
    { type: 'reasoning-delta', index: 0, text: 'b', signature: 'keep' },
    { type: 'reasoning-delta', index: 1, text: 'c' },
    ...chunks(deny).map(c => c.index === undefined ? c : { ...c, index: 2 }),
  ];
  assert.deepEqual(await buffer(input), input);
});

test('merged observations survive source mutation and still detect snapshot conflicts', async () => {
  const mutable = { type: 'reasoning-delta', index: 0, text: 'a' };
  const source = (async function* () {
    yield mutable; mutable.text = 'b'; yield mutable; mutable.text = 'evil';
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'ab' } };
    yield* chunks(deny).map(c => c.index === undefined ? c : { ...c, index: 1 });
  })();
  const out = await collectReviewStream(source, new AbortController().signal, resolveOptions());
  assert.equal(out[0].text, 'ab');
  const conflict = reasoning('a'.repeat(9000));
  conflict.find(c => c.type === 'block-end').block.text += 'changed';
  await assert.rejects(buffer(conflict), { code: 'REVIEW_STREAM_INVALID' });
});

for (const [name, input, config] of [
  ['content', reasoning('a'.repeat(2000)), { maxContentBytes: 1024 }],
  ['retained bytes', reasoning('a'.repeat(2000)), { maxBytes: 1024 }],
  ['replay', [...chunks(deny).slice(0,-1), { type: 'finish', reason: { kind: 'stop' }, replayState: { opaque: 'x'.repeat(2000) } }], { maxReplayBytes: 1024 }],
  ['memory accounting', chunks(deny), { maxMemoryBytes: 1024 }],
  ['buffered fragments', [...Array.from({length: 9}, () => ({type:'usage',usage:{}})), ...chunks(deny)], {maxBufferedChunks:8}],
  ['raw empty-delta flood', reasoning('a'.repeat(20)), { maxChunks: 8 }],
]) test(name + ' budget stops after at most one recovery retry', async () => {
  const h = harness([input], config);
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, 'REVIEW_SIZE_LIMIT');
  assert.equal(h.calls.length, 2);
  h.dispose();
});

test('default raw event flood remains finite even when all deltas merge', async () => {
  const items = Array.from({ length: 65537 }, () => ({type:'reasoning-delta', index:0, text:''}));
  await assert.rejects(buffer(items), { code: 'REVIEW_SIZE_LIMIT' });
});

test('multibyte text including split surrogate pairs preserves exact snapshots', async () => {
  const text = '中文😀'.repeat(300);
  const out = await buffer(reasoning(text), { maxContentBytes: Buffer.byteLength(text) + Buffer.byteLength(deny) });
  assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
});

test('failure history records every bounded attempt and redacts forged internal errors', async () => {
  const h = harness([
    chunks(deny).slice(0,-1),
    [{type:'finish',reason:{kind:'error',failure:{code:'SERVER',message:'SECRET'}}}],
    () => (async function* () { throw new ReviewFormatError('REVIEW_STREAM_INVALID', 'SECRET'); })(),
  ]);
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 3);
  const message = out.at(-1).reason.failure.message;
  assert.match(message, /1:REVIEW_STREAM_INVALID:\d+ms, 2:REVIEW_UPSTREAM_SERVER:\d+ms, 3:REVIEW_STREAM_INVALID:\d+ms/);
  assert.equal(JSON.stringify([out,h.logs]).includes('SECRET'), false);
  h.dispose();
});

test('all additional resource knobs are bounded and explicit old limits remain exact', () => {
  assert.equal(resolveOptions({maxChunks:8192,maxBytes:2048}).maxChunks,8192);
  assert.equal(resolveOptions({maxChunks:8192,maxBytes:2048}).maxBytes,2048);
  for(const key of ['maxContentBytes','maxReplayBytes','maxBufferedChunks','maxMemoryBytes']) {
    for(const value of [0,Infinity,NaN,1.5,1e12]) assert.throws(()=>resolveOptions({[key]:value}));
  }
});

test('failed context finish aborts the attempt and history keeps resource subtype', async () => {
  let signal;
  const h = harness([request => { signal=request.signal; return {
    [Symbol.asyncIterator]() { return {
      next() { return Promise.resolve({done:false,value:{type:'finish',reason:{kind:'error',failure:{code:'CONTEXT_WINDOW_EXCEEDED'}}}}); },
      return() { return new Promise(()=>{}); },
    }; },
  }; }]);
  const out=await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(signal.aborted,true);
  assert.equal(h.calls.length,1);
  assert.match(out[0].reason.failure.message,/1:REVIEW_UPSTREAM_CONTEXT_WINDOW_EXCEEDED:\d+ms/);
  h.dispose();
  const oversized=harness([reasoning('a'.repeat(2000))],{maxContentBytes:1024});
  const error=await collect(oversized.ctx.llm.stream(reviewRequest()));
  assert.match(error[0].reason.failure.message,/REVIEW_SIZE_LIMIT\(content-byte\):\d+ms/);
  oversized.dispose();
});

test('128KiB replay state fits both the old serialized cap and new default and fallback budgets', async () => {
  const input = chunks(deny);
  input.at(-1).replayState = { opaque: 'r'.repeat(131072) };
  const serializedBytes = input.reduce((n, c) => n + Buffer.byteLength(JSON.stringify(c)), 0);
  assert.ok(serializedBytes < 262144, 'This sample also fits the old raw serialized budget');
  assert.equal(resolveOptions().maxReplayBytes, 262144);
  for (const options of [resolveOptions(), { maxBytes: 262144, maxChunks: 8192 }]) {
    const out = await collectReviewStream((async function* () { yield* input; })(), new AbortController().signal, options);
    assert.deepEqual(out.at(-1).replayState, input.at(-1).replayState);
    assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
  }
  const h = harness([input]);
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.deepEqual(out.at(-1).replayState, input.at(-1).replayState);
  assert.equal(h.calls.length, 1);
  h.dispose();
});

test('128KiB replay plus content exceeding the retained total is still rejected', async () => {
  const input = reasoning('r'.repeat(70000), 1024);
  input.at(-1).replayState = { opaque: 's'.repeat(131072) };
  assert.ok(Buffer.byteLength(JSON.stringify(input.at(-1).replayState)) < resolveOptions().maxReplayBytes);
  const h = harness([input]);
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 2);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, 'REVIEW_SIZE_LIMIT');
  assert.match(out[0].reason.failure.message, /retained-byte/);
  h.dispose();
});

for (const retries of [1, 2]) test(`size then valid denial recovers once with retries=${retries}`, async () => {
  const h = harness([chunks('x'.repeat(2000)), chunks(deny)], { maxBytes: 1024, retries });
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(inspectReviewChunks(out).decision.decision, 'deny');
  assert.equal(h.calls.length, 2);
  assert.ok(h.logs.some(line => /accepted=unchanged.*history=1:REVIEW_SIZE_LIMIT/.test(line)));
  h.dispose();
});

for (const retries of [0, 1, 2]) test(`continuous size failures obey the two-attempt cap with retries=${retries}`, async () => {
  const h = harness([chunks('x'.repeat(2000))], { maxBytes: 1024, retries });
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, Math.min(retries + 1, 2));
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, 'REVIEW_SIZE_LIMIT');
  h.dispose();
});

test('size then malformed response cannot restore a third attempt', async () => {
  const h = harness([chunks('x'.repeat(2000)), chunks('invalid JSON'), chunks(deny)], { maxBytes: 1024 });
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 2);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, 'REVIEW_JSON_INVALID');
  h.dispose();
});

test('malformed response then size failure does not dispatch a third attempt', async () => {
  const h = harness([chunks('invalid JSON'), chunks('x'.repeat(2000)), chunks(deny)], { maxBytes: 1024 });
  const out = await collect(h.ctx.llm.stream(reviewRequest()));
  assert.equal(h.calls.length, 2);
  assert.equal(out[0].reason.failure.code, 'REVIEW_SIZE_LIMIT');
  h.dispose();
});
