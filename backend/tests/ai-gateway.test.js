import test from 'node:test';
import assert from 'node:assert/strict';
import {askModel,configureAiUsage,AiGatewayError} from '../src/ai.js';

const previousFetch=globalThis.fetch;
const previousKey=process.env.OPENAI_API_KEY;
const previousLimit=process.env.SKAI_DAILY_AI_CALL_LIMIT;
const previousModel=process.env.OPENAI_MODEL;
process.env.OPENAI_API_KEY='sk-test-ci-not-real';
process.env.OPENAI_MODEL='gpt-4.1-mini';
process.env.SKAI_DAILY_AI_CALL_LIMIT='1';
const usage={reserved:0,completed:0,failed:0};
const db={
 async query(sql,args){
  if(sql.includes('INSERT INTO ai_daily_usage')){
   if(usage.reserved>=1)return {rowCount:0,rows:[]};
   usage.reserved++;
   return {rowCount:1,rows:[{usage_day:args[0]}]};
  }
  if(sql.includes('UPDATE ai_daily_usage')){
   usage.completed+=args[1];
   usage.failed+=args[2];
   return {rowCount:1,rows:[]};
  }
  throw Error('unexpected SQL');
 }
};
configureAiUsage(db);

test('chief of staff AI gateway sends real expected chat-completions payload and accounts tokens using a mock transport',async()=>{
 usage.reserved=0;usage.completed=0;usage.failed=0;
 let calls=0;
 globalThis.fetch=async (url,options)=>{
  calls++;
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  assert.equal(options.method,'POST');
  assert.equal(options.headers.Authorization,'Bearer sk-test-ci-not-real');
  const payload=JSON.parse(options.body);
  assert.equal(payload.model,'gpt-4.1-mini');
  assert.equal(payload.messages.at(-1).content,'請提供 SKAI 今日策略摘要');
  assert.equal(payload.messages.at(-1).role,'user');
  assert.equal(payload.messages[0].role,'system');
  assert.ok(payload.messages[0].content.length>20);
  return {ok:true,json:async()=>({choices:[{message:{content:'今日策略摘要：先驗證系統再擴充。'}}],usage:{prompt_tokens:12,completion_tokens:10}})};
 };
 const result=await askModel({role:'chief_of_staff',messages:[{role:'user',content:'請提供 SKAI 今日策略摘要'}],maxTokens:200});
 assert.equal(result,'今日策略摘要：先驗證系統再擴充。');
 assert.equal(calls,1);
 assert.deepEqual(usage,{reserved:1,completed:1,failed:0});
});
test('daily cap prevents upstream AI calls and returns a recognizable error',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('should not be called')};
 await assert.rejects(()=>askModel({role:'chief_of_staff',messages:[{role:'user',content:'again'}]}),e=>e instanceof AiGatewayError&&e.message==='ai_daily_limit_reached');
 assert.equal(calls,0);
});
test('upstream error counts failed AI attempts',async()=>{
 usage.reserved=0;usage.completed=0;usage.failed=0;
 globalThis.fetch=async()=>({ok:false,status:429});
 await assert.rejects(()=>askModel({role:'chief_of_staff',messages:[{role:'user',content:'test'}]}),e=>e instanceof AiGatewayError&&e.message==='ai_upstream_http_429');
 assert.deepEqual(usage,{reserved:1,completed:0,failed:1});
});
test.after(()=>{
 globalThis.fetch=previousFetch;configureAiUsage(null);
 if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
 if(previousLimit===undefined)delete process.env.SKAI_DAILY_AI_CALL_LIMIT;else process.env.SKAI_DAILY_AI_CALL_LIMIT=previousLimit;
 if(previousModel===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=previousModel;
});
