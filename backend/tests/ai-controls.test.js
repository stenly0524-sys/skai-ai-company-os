import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAiControls,effectiveCallLimit,readAiControls,reserveAiCall,finalizeAiCall} from '../src/operations.js';
const settings={ai_enabled:true,daily_call_limit:4,daily_token_warning:1000,daily_budget_usd:1,monthly_budget_usd:10};
const dayUsage={reserved_calls:0,completed_calls:0,failed_calls:0,total_input_tokens:0,total_output_tokens:0};
const notifications=[];
const db={
 async query(sql,args){
  if(sql.startsWith('SELECT ai_enabled'))return {rowCount:1,rows:[{...settings}]};
  if(sql.includes('INSERT INTO ai_daily_usage')){
   if(dayUsage.reserved_calls>=Math.min(Number(process.env.SKAI_DAILY_AI_CALL_LIMIT),settings.daily_call_limit))return {rowCount:0,rows:[]};
   dayUsage.reserved_calls++;return {rowCount:1,rows:[{usage_day:args[0]}]};
  }
  if(sql.includes('UPDATE ai_daily_usage')){
   dayUsage.completed_calls+=args[1];dayUsage.failed_calls+=args[2];
   dayUsage.total_input_tokens+=args[3];dayUsage.total_output_tokens+=args[4];
   return {rowCount:1,rows:[{...dayUsage}]};
  }
  if(sql.includes('INSERT INTO notification_events')){
   if(!notifications.some(n=>n.key===args[0]))notifications.push({key:args[0],body:args[1]});
   return {rowCount:1,rows:[]};
  }
  throw Error('Unexpected SQL: '+sql);
 }
};
test('CEO AI setting validation permits only exact types and safe ranges',()=>{
 assert.deepEqual(validateAiControls({ai_enabled:true,daily_call_limit:30,daily_token_warning:1000,daily_budget_usd:1,monthly_budget_usd:10}),{
  ai_enabled:true,daily_call_limit:30,daily_token_warning:1000,daily_budget_usd:1,monthly_budget_usd:10
 });
 for(const bad of [
  {ai_enabled:'false',daily_call_limit:30,daily_token_warning:1000,daily_budget_usd:1,monthly_budget_usd:10},
  {ai_enabled:false,daily_call_limit:0,daily_token_warning:1000,daily_budget_usd:1,monthly_budget_usd:10},
  {ai_enabled:true,daily_call_limit:501,daily_token_warning:1000,daily_budget_usd:1,monthly_budget_usd:10},
  {ai_enabled:true,daily_call_limit:30,daily_token_warning:999,daily_budget_usd:1,monthly_budget_usd:10},
  {ai_enabled:true,daily_call_limit:30,daily_token_warning:1000,role:'admin',daily_budget_usd:1,monthly_budget_usd:10}
 ])assert.throws(()=>validateAiControls(bad),/invalid_ai_settings/);
});
test('daily AI cap reflects lower CEO limit while preserving deploy ceiling',async()=>{
 const old=process.env.SKAI_DAILY_AI_CALL_LIMIT;
 process.env.SKAI_DAILY_AI_CALL_LIMIT='3';
 try{
  dayUsage.reserved_calls=0;
  settings.ai_enabled=true;settings.daily_call_limit=2;
  const s=await readAiControls(db);
  assert.equal(effectiveCallLimit(s),2);
  await reserveAiCall(db);await reserveAiCall(db);
  await assert.rejects(reserveAiCall(db),/ai_daily_limit_reached/);
  settings.ai_enabled=false;
  await assert.rejects(reserveAiCall(db),/ai_disabled_by_ceo/);
  settings.ai_enabled=true;
  settings.daily_call_limit=5;
  dayUsage.reserved_calls=0;
  assert.equal(effectiveCallLimit(settings),3);
  await reserveAiCall(db);await reserveAiCall(db);await reserveAiCall(db);
  await assert.rejects(reserveAiCall(db),/ai_daily_limit_reached/);
 }finally{
  if(old===undefined)delete process.env.SKAI_DAILY_AI_CALL_LIMIT;else process.env.SKAI_DAILY_AI_CALL_LIMIT=old;
 }
});
test('Token threshold sends one internal notification; warning is not a currency hard cap',async()=>{
 const old=process.env.SKAI_DAILY_AI_CALL_LIMIT;
 process.env.SKAI_DAILY_AI_CALL_LIMIT='50';
 try{
  settings.ai_enabled=true;settings.daily_call_limit=50;settings.daily_token_warning=1000;
  dayUsage.reserved_calls=0;dayUsage.total_input_tokens=0;dayUsage.total_output_tokens=0;
  notifications.length=0;
  const day=await reserveAiCall(db);
  await finalizeAiCall(db,day,{prompt_tokens:600,completion_tokens:500},true);
  assert.equal(notifications.length,1);
  assert.match(notifications[0].body,/非美元費用/);
  await finalizeAiCall(db,day,{prompt_tokens:1,completion_tokens:1},true);
  assert.equal(notifications.length,1);
 }finally{
  if(old===undefined)delete process.env.SKAI_DAILY_AI_CALL_LIMIT;else process.env.SKAI_DAILY_AI_CALL_LIMIT=old;
 }
});
