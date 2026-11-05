import crypto from 'node:crypto';
import express from 'express';
import {driveClient,DriveDeliveryError} from './drive-delivery.js';

const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT='https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const ORIGIN=()=>process.env.PUBLIC_ORIGIN;
const REDIRECT=()=>ORIGIN()+'/api/google-oauth/callback';
const HAS_CONFIG=()=>Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID&&process.env.GOOGLE_DRIVE_CLIENT_SECRET&&/^[0-9a-fA-F]{64}$/.test(process.env.SKAI_DRIVE_ENCRYPTION_KEY||'')&&/^https:\/\/[^/]+$/.test(ORIGIN()||''));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

export function encryptRefreshToken(token,key=process.env.SKAI_DRIVE_ENCRYPTION_KEY){
 if(!/^[0-9a-fA-F]{64}$/.test(key||''))throw new Error('drive_encryption_key_missing');
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}
export function decryptRefreshToken(encrypted,key=process.env.SKAI_DRIVE_ENCRYPTION_KEY){
 if(!/^[0-9a-fA-F]{64}$/.test(key||'')||typeof encrypted!=='string')throw new Error('drive_encryption_unavailable');
 const [iv,tag,body]=encrypted.split('.');
 if(!iv||!tag||!body)throw new Error('drive_encryption_invalid');
 const cipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64url'));
 cipher.setAuthTag(Buffer.from(tag,'base64url'));
 return Buffer.concat([cipher.update(Buffer.from(body,'base64url')),cipher.final()]).toString('utf8');
}
export async function savedDriveConnection(db){
 const q=await db.query('SELECT refresh_token_ciphertext FROM drive_oauth_connection WHERE slot=$1',['ceo']);
 return q.rows[0]||null;
}
export async function driveClientForCompany(db){
 const connection=await savedDriveConnection(db);
 if(!connection)throw new DriveDeliveryError('drive_not_connected',409);
 const refreshToken=decryptRefreshToken(connection.refresh_token_ciphertext);
 return driveClient(fetch,{refreshToken});
}
export function googleOAuthRouter(db,{fetchImpl=fetch}={}){
 const protectedApi=express.Router();
 const publicCallback=express.Router();
 protectedApi.get('/status',async(_req,res)=>{
  try{
   const q=await db.query('SELECT connected_at,scope FROM drive_oauth_connection WHERE slot=$1',['ceo']);
   res.json({configured:HAS_CONFIG(),connected:HAS_CONFIG()&&q.rowCount>0,
    mode:!HAS_CONFIG()?'oauth_setup_required':q.rowCount?'connected':'authorization_required',
    connected_at:q.rows[0]?.connected_at||null,
    scope:q.rows[0]?.scope||null,
    callback_url:REDIRECT(),
    notice:!HAS_CONFIG()?'需先在 Render 安全設定 Google Client ID、Client Secret 與加密金鑰。':q.rowCount?'Google Drive 已完成授權，但既有資料夾仍需由使用者透過檔案選取流程授予應用程式存取權。':'按「連接 Google Drive」前往 Google 官方畫面授權。'});
  }catch(e){console.error('OAuth status:',e?.message);res.status(500).json({error:'oauth_status_unavailable'});}
 });
 protectedApi.post('/start',async(req,res)=>{
  if(!req.ceoSession)return res.status(403).json({error:'ceo_login_required'});
  if(!HAS_CONFIG())return res.status(409).json({error:'oauth_configuration_incomplete'});
  const nonce=crypto.randomBytes(32).toString('base64url');
  try{
   await db.query('INSERT INTO drive_oauth_states(state_hash,ceo_session_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL \'10 minutes\')',[sha(nonce),req.ceoSession]);
   const url=new URL(AUTH_ENDPOINT);
   for(const [k,v] of Object.entries({
    client_id:process.env.GOOGLE_DRIVE_CLIENT_ID,
    redirect_uri:REDIRECT(),response_type:'code',scope:SCOPE,
    state:nonce,access_type:'offline',prompt:'consent'
   }))url.searchParams.set(k,v);
   res.json({authorization_url:url.toString(),expires_in_seconds:600});
  }catch(e){console.error('OAuth start:',e?.message);res.status(503).json({error:'oauth_session_unavailable'});}
 });
 protectedApi.post('/disconnect',async(req,res)=>{
  if(!req.ceoSession||req.body?.confirm!==true)return res.status(403).json({error:'ceo_confirmation_required'});
  try{
   const q=await db.query('DELETE FROM drive_oauth_connection WHERE slot=$1 RETURNING slot',['ceo']);
   await db.query("INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES('ceo','google_drive.disconnected','integration',NULL,$1::jsonb)",[JSON.stringify({disconnected:q.rowCount>0})]);
   res.json({connected:false,notice:'SKAI OS 已不再保存此 Google Drive 授權。若需立即撤銷 Google 端同意，請在 Google 帳戶安全設定中移除應用程式存取權。'});
  }catch(e){console.error('OAuth disconnect:',e?.message);res.status(500).json({error:'oauth_disconnect_failed'});}
 });
 publicCallback.get('/callback',async(req,res)=>{
  // Google redirects the user browser here; do NOT require a session cookie or CSRF header.
  // The one-use 256-bit state is bound to the original CEO session in the database.
  const code=req.query?.code,state=req.query?.state;
  const exit=(reason)=>res.redirect(303,'/?drive_oauth='+encodeURIComponent(reason)+'#data');
  if(typeof state!=='string'||state.length>180||typeof code!=='string'||code.length>4096)return exit('invalid_response');
  try{
   const q=await db.query('UPDATE drive_oauth_states SET used_at=NOW() WHERE state_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING ceo_session_hash',[sha(state)]);
   if(!q.rowCount)return exit('expired_or_replayed');
   const owner=await db.query('SELECT 1 FROM ceo_sessions WHERE token_hash=$1 AND expires_at>NOW()',[q.rows[0].ceo_session_hash]);
   if(!owner.rowCount)return exit('ceo_session_expired');
   if(!HAS_CONFIG())return exit('server_not_configured');
   const params=new URLSearchParams({code,client_id:process.env.GOOGLE_DRIVE_CLIENT_ID,
    client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET,redirect_uri:REDIRECT(),grant_type:'authorization_code'});
   const response=await fetchImpl(TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:AbortSignal.timeout(12000)});
   if(!response.ok)return exit('token_exchange_failed');
   const tokens=await response.json();
   if(typeof tokens.refresh_token!=='string'||tokens.refresh_token.length<20)return exit('refresh_token_not_returned');
   const scopes=String(tokens.scope||'');
   if(!scopes.split(/\s+/).includes(SCOPE))return exit('required_scope_not_granted');
   const ciphertext=encryptRefreshToken(tokens.refresh_token);
   await db.query(`INSERT INTO drive_oauth_connection(slot,refresh_token_ciphertext,scope,connected_at,updated_at)
     VALUES('ceo',$1,$2,NOW(),NOW())
     ON CONFLICT(slot) DO UPDATE SET refresh_token_ciphertext=$1,scope=$2,connected_at=NOW(),updated_at=NOW()`,[ciphertext,scopes]);
   await db.query("INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES('ceo','google_drive.connected','integration',NULL,$1::jsonb)",[JSON.stringify({scope:SCOPE})]);
   return exit('connected');
  }catch(e){console.error('OAuth callback:',e?.name||'error');return exit('connection_failed');}
 });
 return {protectedApi,publicCallback};
}
