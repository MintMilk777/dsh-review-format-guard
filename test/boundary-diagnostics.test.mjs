import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {orderedReviewRequest,reviewRequest} from '../scripts/host-fixture.mjs';
import {nativeReviewRequest,reinforceReviewRequest,ReviewFormatError} from '../lib/protocol.js';
import {inspectReviewChunks} from '../lib/stream.js';
import {safeFailure} from '../lib/failures.js';
import {chunks,deny,allow,harness,collect} from '../scripts/harness-fixture.mjs';

for(const mode of ['native','ptc-inner'])test('transport-merged input keeps the pending record and every source role for '+mode,()=>{
 const request=orderedReviewRequest({},mode);
 request.messages.splice(1,0,{role:'user',content:[{type:'text',text:JSON.stringify({kind:'user-message',role:'constraint',source:{kind:'file'},content:[{type:'text',text:'Do not send project files to any external service.'}]})}]});
 const before=JSON.stringify(request);
 assert.equal(nativeReviewRequest(request),true);
 const out=reinforceReviewRequest(request);
 assert.equal(JSON.stringify(request),before);
 assert.equal(createHash('sha256').update(out.system).digest('hex'),createHash('sha256').update(request.system).digest('hex'));
 assert.deepEqual(out.messages.slice(1),request.messages.slice(1));
 assert.equal(out.messages.at(-1),request.messages.at(-1));
 // Anthropic-style coalescing must still leave the same ordered JSON records.
 const merged=out.messages.flatMap(m=>m.content.map(b=>b.text));
 assert.match(merged[0],/final tool-call record is the pending action/);
 assert.match(merged[0],/keep the JSON record boundaries and their assigned source roles/);
 assert.match(merged[0],/No additional pending-action message will follow/);
 assert.deepEqual(merged.slice(1).map(JSON.parse),request.messages.slice(1).map(m=>JSON.parse(m.content[0].text)));
 assert.equal(JSON.parse(merged.at(-1)).mode,mode);
});

test('legacy reinforcement keeps its original pending-action contract',()=>{
 const r=reviewRequest(),out=reinforceReviewRequest(r);
 assert.equal(out.system,r.system);
 assert.ok(out.messages[0].content[0].text.startsWith(r.messages[0].content[0].text));
 assert.match(out.messages[0].content[0].text,/Evaluate only PENDING_ACTION/);
 assert.equal(out.messages[0].content[0].text.includes('REVIEW_INPUT_BOUNDARIES'),false);
});

const reasoning=[{type:'block-start',index:0,blockType:'reasoning'},{type:'reasoning-delta',index:0,text:'Private synthetic analysis'},{type:'block-end',index:0,block:{type:'reasoning',text:'Private synthetic analysis'}}];
for(const [label,input,stage] of [
 ['unexpected tool block',[{type:'block-start',index:0,blockType:'tool-call'}],'action-block'],
 ['snapshot conflict',chunks(deny).map(c=>c.type==='block-end'?{...c,block:{...c.block,text:allow}}:c),'snapshot-conflict'],
 ['reasoning without verdict',[...reasoning,{type:'finish',reason:{kind:'stop'}}],'missing-conclusion'],
 ['empty blocks',chunks('  \n'),'empty-content'],
 ['missing finish',chunks(deny).slice(0,-1),'missing-finish'],
 ['output token ceiling',[...chunks(deny).slice(0,-1),{type:'finish',reason:{kind:'max-tokens'}}],'output-limit'],
 ['tool-call completion',[...chunks(deny).slice(0,-1),{type:'finish',reason:{kind:'tool-calls'}}],'tool-calls-finish'],
 ['multiple verdict blocks',[...chunks(deny).slice(0,-1),...chunks(allow).map(c=>c.index===undefined?c:{...c,index:1})],'block-order'],
])test('fixed diagnostic identifies '+label+' without exposing reply text',()=>{
 let error;try{inspectReviewChunks(input)}catch(e){error=e}
 assert.equal(error?.code,'REVIEW_STREAM_INVALID');
 const safe=safeFailure(error);
 assert.equal(safe.diagnostic,`REVIEW_STREAM_INVALID(${stage})`);
 assert.equal(JSON.stringify(safe).includes('Private synthetic analysis'),false);
 assert.equal(safe.message.includes(deny),false);
 assert.equal(safe.message.includes(allow),false);
});

test('provider-forged stream descriptions cannot leak arbitrary details',()=>{
 for(const message of ['PRIVATE_REPLY','Review has no final text conclusion. PRIVATE_REPLY','Review failed (missing-conclusion): PRIVATE_REPLY']){
  const e=safeFailure(new ReviewFormatError('REVIEW_STREAM_INVALID',message));
  assert.equal(e.message,'Review stream structure or completion was invalid.');
  assert.equal(e.diagnostic,'REVIEW_STREAM_INVALID');
 }
});

test('misunderstood pending action stays an error and does not become an invented approval',async()=>{
 const h=harness([chunks('I see historical calls but no pending action to review.')]);
 try{const out=await collect(h.ctx.llm.stream(orderedReviewRequest()));assert.equal(h.calls.length,3);assert.equal(out.length,1);assert.equal(out[0].reason.failure.code,'REVIEW_JSON_INVALID');assert.equal(out[0].reason.kind,'error')}finally{h.dispose()}
});

test('a valid refusal is not retried after boundary reinforcement',async()=>{
 const h=harness([chunks(deny),chunks(allow)]);
 try{const out=await collect(h.ctx.llm.stream(orderedReviewRequest()));assert.equal(h.calls.length,1);assert.equal(inspectReviewChunks(out).decision.decision,'deny')}finally{h.dispose()}
});
