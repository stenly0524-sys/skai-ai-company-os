import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateReservation,estimatedActualUsd,pricingFor,reserveCost,settleCost,costUsage} from '../src/cost-control.js';
import {taipeiParts} from '../src/operations.js';
const state={
 settings:{ai_enabled:true,daily_budget_usd:'0.01',monthly_budget_usd:'0.10'},
 entries:[],id:0
};
const db={
 async connect(){return {query:(sql,args)=>db.query(sql,args),release(){}};},
 async query(sql,args){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rowCount:0,rows:[]};
  if(sql.includes('FROM ai_control_settings')&&sql.includes('FOR UPDATE'))
   return {rowCount:1,rows:[{...state.settings}]};
  if(sql.includes('FROM ai_cost_ledger WHERE usage_month')){
   const [day,month]=args;
   const cost=(e)=>e.status==='settled'?e.estimated_usd:e.reserved_usd;
   const entries=state.entries.filter(e=>e.month===month);
   return {rowCount:1,rows:[{
    daily_usd:entries.filter(e=>e.day===day).reduce((s,e)=>s+cost(e),0),
    monthly_usd:entries.reduce((s,e)=>s+cost(e),0)
   }]};
  }
  if(sql.includes('INSERT INTO ai_cost_ledger')){
   const [day,month,model,usd]=args,id='ledger-'+(++state.id);
   state.entries.push({id,day,month,model,reserved_usd:usd,estimated_usd:0,status:'reserved'});
   return {rowCount:1,rows:[{id}]};
  }
  if(sql.includes('UPDATE ai_cost_ledger')){
   const [id,status,estimated_usd,input,output]=args;
   const e=state.entries.find(e=>e.id===id);
   e.status=status;e.estimated_usd=estimated_usd;e.input=input;e.output=output;
   return {rowCount:1,rows:[]};
  }
  if(sql.includes('COUNT(*) FILTER(WHERE status=')){
   const [day,month]=args;
   const entries=state.entries.filter(e=>e.month===month);
   const cost=e=>e.status==='settled'?e.estimated_usd:e.reserved_usd;
   return {rowCount:1,rows:[{
    day_usd:entries.filter(e=>e.day===day).reduce((s,e)=>s+cost(e),0),
    month_usd:entries.reduce((s,e)=>s+cost(e),0),
    unverified_count:entries.filter(e=>e.status==='unverified').length
   }]};
  }
  throw Error('Unrecognized SQL '+sql);
 }
};
function request(maxOutputTokens=500){return {model:'gpt-4.1-mini',messages:[{role:'user',content:'測試商業分析'}],maxOutputTokens};}
test('unknown models fail closed; explicit published prices drive estimates',()=>{
 assert.deepEqual(pricingFor('gpt-4.1-mini'),{input:0.4,output:1.6});
 assert.throws(()=>pricingFor('unknown-model'),/ai_model_pricing_unconfigured/);
 assert.ok(estimateReservation(request())>0.0008);
 assert.equal(estimatedActualUsd('gpt-4.1-mini',{prompt_tokens:1000,completion_tokens:200}),0.00072);
});
test('daily and monthly budget checks block calls before upstream execution',async()=>{
 state.entries.length=0;state.id=0;
 state.settings={ai_enabled:true,daily_budget_usd:'0.001',monthly_budget_usd:'0.01'};
 const first=await reserveCost(db,request(200));
 assert.ok(first.reservation_usd>0);
 await assert.rejects(async()=>{
  for(let i=0;i<20;i++)await reserveCost(db,request(200));
 },/ai_daily_usd_budget_reached/);
 const usage=await costUsage(db);
 assert.ok(usage.day_usd<=0.001+1e-9);
 state.settings={ai_enabled:true,daily_budget_usd:'1.00',monthly_budget_usd:'0.001'};
 state.entries.length=0;
 await reserveCost(db,request(200));
 await assert.rejects(async()=>{
  for(let i=0;i<20;i++)await reserveCost(db,request(200));
 },/ai_monthly_usd_budget_reached/);
});
test('settlement releases unused allowance on known token accounting but preserves unknown requests',async()=>{
 state.entries.length=0;state.settings={ai_enabled:true,daily_budget_usd:'1.00',monthly_budget_usd:'10.00'};
 const r=await reserveCost(db,request());
 await settleCost(db,r,{usage:{prompt_tokens:100,completion_tokens:50}});
 const e=state.entries[0];assert.equal(e.status,'settled');
 assert.equal(e.estimated_usd,0.00012);
 const z=await reserveCost(db,request());
 await settleCost(db,z,{usage:null});
 assert.equal(state.entries[1].status,'unverified');
 const totals=await costUsage(db,taipeiParts().day);
 assert.equal(totals.unverified_count,1);
 assert.ok(totals.day_usd>=z.reservation_usd+e.estimated_usd-1e-10);
});
test('CEO pause stops USD reservations without consuming budget',async()=>{
 const before=state.entries.length;
 state.settings.ai_enabled=false;
 await assert.rejects(reserveCost(db,request()),/ai_disabled_by_ceo/);
 assert.equal(state.entries.length,before);
 state.settings.ai_enabled=true;
});
