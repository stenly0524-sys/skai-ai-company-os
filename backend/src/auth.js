import crypto from 'node:crypto';
import { tokenMatches } from './security.js';

const HASH = x => crypto.createHash('sha256').update(x).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const SESSION_MS = 12 * 60 * 60 * 1000;
export const COOKIE_NAME = 'skai_session';

export function cookieValue(header,name=COOKIE_NAME){
 if(typeof header!=='string')return null;
 const match=header.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
 return match?match.slice(name.length+1):null;
}
export function sessionCookie(value,secure=true,maxAge=Math.floor(SESSION_MS/1000)){
 return COOKIE_NAME+'='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(secure?'; Secure':'');
}
export function validPassword(candidate,expected){
 if(typeof candidate!=='string'||typeof expected!=='string')return false;
 return tokenMatches(candidate,expected);
}
export function sameOrigin(request){
 const origin=request.get('origin');
 if(!origin)return true; // Non-browser requests still need authentication.
 try{
  const originUrl=new URL(origin);
  // Hosted environments must specify an exact trusted external origin.
  const current=process.env.PUBLIC_ORIGIN || request.protocol+'://'+request.get('host');
  return originUrl.origin===new URL(current).origin;
 }catch{return false}
}
export function authRouter(db){
 const attempts=new Map();
 function rateLimit(key){
  const now=Date.now();
  // Simple single-instance defense. A shared limiter is needed for production.
  for(const [k,v] of attempts){if(v.reset<now)attempts.delete(k)}
  const entry=attempts.get(key)||{count:0,reset:now+900_000};
  entry.count++;attempts.set(key,entry);
  return entry.count<=5;
 }
 return {
  async login(req,res){
   if(!sameOrigin(req))return res.status(403).json({error:'origin_not_allowed'});
   if(!rateLimit(req.ip||'unknown'))return res.status(429).json({error:'too_many_attempts'});
   if(!validPassword(req.body?.password,process.env.SKAI_CEO_PASSWORD))return res.status(401).json({error:'invalid_credentials'});
   const token=random(),csrf=random();
   try{
    await db.query('INSERT INTO ceo_sessions(token_hash,csrf_hash,expires_at) VALUES($1,$2,$3)',[HASH(token),HASH(csrf),new Date(Date.now()+SESSION_MS)]);
    attempts.delete(req.ip||'unknown');
    res.set('Set-Cookie',sessionCookie(token,process.env.NODE_ENV==='production'));
    res.json({authenticated:true,csrf_token:csrf,expires_in_seconds:SESSION_MS/1000});
   }catch(e){console.error('session error:',e?.message);res.status(503).json({error:'session_store_unavailable'})}
  },
  async authenticate(req,res,next){
   if(!sameOrigin(req))return res.status(403).json({error:'origin_not_allowed'});
   const token=cookieValue(req.get('cookie'));
   if(!token)return res.status(401).json({error:'login_required'});
   try{
    const q=await db.query('SELECT csrf_hash FROM ceo_sessions WHERE token_hash=$1 AND expires_at>NOW()',[HASH(token)]);
    if(!q.rowCount)return res.status(401).json({error:'session_expired'});
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
     const csrf=req.get('x-csrf-token');
     if(typeof csrf!=='string'||!tokenMatches(HASH(csrf),q.rows[0].csrf_hash))return res.status(403).json({error:'csrf_invalid'});
    }
    req.ceoSession=HASH(token);
    next();
   }catch(e){console.error('session read error:',e?.message);res.status(503).json({error:'session_store_unavailable'})}
  },
  async logout(req,res){
   try{if(req.ceoSession)await db.query('DELETE FROM ceo_sessions WHERE token_hash=$1',[req.ceoSession]);}
   catch(e){console.error('session logout error:',e?.message)}
   res.set('Set-Cookie',sessionCookie('',process.env.NODE_ENV==='production',0));
   res.json({authenticated:false});
  },
  async session(req,res){
   try{
    const csrf=random();
    await db.query('UPDATE ceo_sessions SET csrf_hash=$1,last_seen_at=NOW() WHERE token_hash=$2',[HASH(csrf),req.ceoSession]);
    res.json({authenticated:true,csrf_token:csrf,mode:'ceo_session',notice:'單一 CEO 測試帳號；正式環境需完整身分及權限管理。'});
   }catch{res.status(503).json({error:'session_store_unavailable'})}
  }
 };
}
