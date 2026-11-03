import express from 'express';
import { emitEvent, performChecks, taipeiParts,capFromEnv } from './operations.js';
import { validUuid } from './security.js';
export function operationsRouter(db){
 const api=express.Router();
 api.get('/notifications',async(req,res)=>{
  try{
   const q=await db.query("SELECT * FROM notification_events ORDER BY created_at DESC LIMIT 100");
   res.json({notifications:q.rows,notice:'SKAI 內部收件匣，尚未串接 ChatGPT App 推播'});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.post('/notifications/:id/read',async(req,res)=>{
  if(!validUuid(req.params.id))return res.status(400).json({error:'invalid_id'});
  try{
   const q=await db.query("UPDATE notification_events SET status='read',read_at=NOW() WHERE id=$1 RETURNING id,status",[req.params.id]);
   if(!q.rowCount)return res.status(404).json({error:'not_found'});
   res.json({notification:q.rows[0]});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.get('/usage',async(req,res)=>{
  try{
   const day=taipeiParts().day;
   const q=await db.query('SELECT * FROM ai_daily_usage WHERE usage_day=$1',[day]);
   res.json({day,cap:capFromEnv(process.env.SKAI_DAILY_AI_CALL_LIMIT),usage:q.rows[0]||{reserved_calls:0,completed_calls:0,failed_calls:0,total_input_tokens:0,total_output_tokens:0},notice:'此為 SKAI OpenAI API 自訂呼叫額度，不是 ChatGPT Plus 方案餘額或真正貨幣費用上限。'});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.post('/checks/run',async(_req,res)=>{
  try{const created=await performChecks(db);res.json({created,notice:'僅建立內部通知紀錄；不會推播到 ChatGPT App'})}
  catch{res.status(500).json({error:'internal_error'})}
 });
 return api;
}
