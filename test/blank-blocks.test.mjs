import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectReviewChunks,normalizedChunks} from '../lib/stream.js';
import {chunks,deny,allow,harness,collect} from '../scripts/harness-fixture.mjs';
import {orderedReviewRequest} from '../scripts/host-fixture.mjs';
const block=(index,type,text)=>[{type:'block-start',index,blockType:type},{type:type==='text'?'text-delta':'reasoning-delta',index,text},{type:'block-end',index,block:{type,text,signature:'blank-signature'}}];
const stop={type:'finish',reason:{kind:'stop'},replayState:{synthetic:'stale'}};
const verdict=index=>chunks(deny).slice(0,-1).map(c=>({...c,index}));
for(const [name,input] of [
 ['leading empty text',[...block(0,'text',''),...verdict(1),stop]],
 ['leading whitespace text',[...block(0,'text',' \n'),...verdict(1),stop]],
 ['trailing empty text',[...verdict(0),...block(1,'text',''),stop]],
 ['trailing whitespace text',[...verdict(0),...block(1,'text',' \n'),stop]],
 ['trailing blank reasoning',[...verdict(0),...block(1,'reasoning',' \n'),stop]],
])test('whole blank blocks normalize without changing a refusal: '+name,()=>{
 const before=JSON.stringify(input),inspection=inspectReviewChunks(input),out=normalizedChunks(input,inspection);
 assert.equal(JSON.stringify(input),before);assert.equal(inspection.changed,true);
 assert.deepEqual(inspection.decision,JSON.parse(deny));
 assert.equal(out.filter(c=>c.type==='block-end').length,1);
 assert.equal(out.find(c=>c.type==='block-end').block.text,deny);
 assert.equal(out.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),deny);
 assert.equal(Object.hasOwn(out.at(-1),'replayState'),false);
 assert.equal(inspectReviewChunks(out).changed,false);
});
test('blank-block cleanup preserves usage and substantive reasoning metadata',()=>{
 const reasoning=block(0,'reasoning','Do not perform the action.');
 const usage={type:'usage',index:1,usage:{outputTokens:10}};
 const input=[...reasoning,...block(1,'text','\n'),usage,...verdict(2),stop];
 const out=normalizedChunks(input,inspectReviewChunks(input));
 assert.deepEqual(out.slice(0,reasoning.length),reasoning);assert.ok(out.includes(usage));
 assert.throws(()=>inspectReviewChunks([...verdict(0),...chunks(allow).map(c=>c.index===undefined?c:{...c,index:1})]),e=>e.code==='REVIEW_STREAM_INVALID');
});
test('a refusal wrapped in blank blocks is returned on the first attempt',async()=>{
 const h=harness([[...block(0,'text',' '),...verdict(1),stop],chunks(allow)]);
 try{const out=await collect(h.ctx.llm.stream(orderedReviewRequest()));assert.equal(h.calls.length,1);assert.equal(inspectReviewChunks(out).decision.decision,'deny');}finally{h.dispose();}
});
test('blank blocks do not bypass raw stream budgets before normalization',async()=>{
 const input=[...block(0,'text',''),...block(1,'text',' '),...verdict(2),stop];
 const h=harness([input],{maxChunks:8,retries:0});
 try{const out=await collect(h.ctx.llm.stream(orderedReviewRequest()));assert.equal(out.at(-1).reason.failure.code,'REVIEW_SIZE_LIMIT');assert.equal(h.calls.length,1);}finally{h.dispose();}
});
