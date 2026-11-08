import crypto from 'node:crypto';
import { tokenMatches } from './security.js';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

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
 const passkeySetup=()=>db.query("CREATE TABLE IF NOT EXISTS ceo_passkeys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter BIGINT NOT NULL DEFAULT 0, transports JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())").then(()=>db.query("CREATE TABLE IF NOT EXISTS ceo_passkey_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, session_hash TEXT)"));
 const rpID=()=>new URL(process.env.PUBLIC_ORIGIN).hostname;
 const origin=()=>new URL(process.env.PUBLIC_ORIGIN).origin;
 async function newChallenge(kind,challenge,sessionHash=null){
  await passkeySetup();
  const id=random();
  await db.query("DELETE FROM ceo_passkey_challenges WHERE expires_at<NOW()");
  await db.query("INSERT INTO ceo_passkey_challenges(id,challenge,kind,expires_at,session_hash) VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes',$4)",[id,challenge,kind,sessionHash]);
  return id;
 }
 async function consumeChallenge(id,kind,sessionHash=null){
  await passkeySetup;
  const q=await db.query("DELETE FROM ceo_passkey_challenges WHERE id=$1 AND kind=$2 AND expires_at>NOW() AND ($3::text IS NULL OR session_hash=$3) RETURNING challenge",[id,kind,sessionHash]);
  return q.rows[0]?.challenge;
 }
 async function issueSession(res){
  const token=random(),csrf=random();
  await db.query('INSERT INTO ceo_sessions(token_hash,csrf_hash,expires_at) VALUES($1,$2,$3)',[HASH(token),HASH(csrf),new Date(Date.now()+SESSION_MS)]);
  res.set('Set-Cookie',sessionCookie(token,process.env.NODE_ENV==='production'));
  res.json({authenticated:true,csrf_token:csrf,expires_in_seconds:SESSION_MS/1000});
 }

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
   try{
    await issueSession(res);
    attempts.delete(req.ip||'unknown');
   }catch(e){console.error('session error:',e?.message);res.status(503).json({error:'session_store_unavailable'})}
  },

  async passkeyStatus(req,res){
   try{await passkeySetup;const q=await db.query('SELECT COUNT(*)::int AS count FROM ceo_passkeys');res.json({enabled:q.rows[0].count>0,count:q.rows[0].count});}
   catch{res.status(503).json({error:'passkey_unavailable'});}
  },
  async registrationOptions(req,res){
   try{
    await passkeySetup;
    const keys=await db.query('SELECT id,transports FROM ceo_passkeys');
    const options=await generateRegistrationOptions({rpName:'SKAI OS',rpID:rpID(),userName:'SKAI CEO',userDisplayName:'CEO',attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:keys.rows.map(x=>({id:x.id,transports:x.transports}))});
    const requestId=await newChallenge('register',options.challenge,req.ceoSession);
    res.json({options,requestId});
   }catch(e){console.error('passkey options:',e?.message);res.status(503).json({error:'passkey_unavailable'});}
  },
  async registerPasskey(req,res){
   try{
    const challenge=await consumeChallenge(req.body?.requestId,'register',req.ceoSession);
    if(!challenge)return res.status(400).json({error:'challenge_expired'});
    const verification=await verifyRegistrationResponse({response:req.body?.response,expectedChallenge:challenge,expectedOrigin:origin(),expectedRPID:rpID(),requireUserVerification:true});
    if(!verification.verified||!verification.registrationInfo)return res.status(401).json({error:'passkey_verification_failed'});
    const c=verification.registrationInfo.credential;
    await db.query('INSERT INTO ceo_passkeys(id,public_key,counter,transports) VALUES($1,$2,$3,$4)',[c.id,Buffer.from(c.publicKey).toString('base64'),c.counter,JSON.stringify(c.transports||[])]);
    res.json({registered:true});
   }catch(e){console.error('passkey register:',e?.message);res.status(400).json({error:'passkey_registration_failed'});}
  },
  async authenticationOptions(req,res){
   if(!sameOrigin(req))return res.status(403).json({error:'origin_not_allowed'});
   if(!rateLimit('passkey:'+req.ip))return res.status(429).json({error:'too_many_attempts'});
   try{
    await passkeySetup;
    const keys=await db.query('SELECT id,transports FROM ceo_passkeys');
    if(!keys.rowCount)return res.status(404).json({error:'passkey_not_registered'});
    const options=await generateAuthenticationOptions({rpID:rpID(),userVerification:'required',allowCredentials:keys.rows.map(x=>({id:x.id,transports:x.transports}))});
    const requestId=await newChallenge('authenticate',options.challenge);
    res.json({options,requestId});
   }catch(e){console.error('passkey authentication options:',e?.message);res.status(503).json({error:'passkey_unavailable'});}
  },
  async authenticatePasskey(req,res){
   if(!sameOrigin(req))return res.status(403).json({error:'origin_not_allowed'});
   if(!rateLimit('passkey-verify:'+req.ip))return res.status(429).json({error:'too_many_attempts'});
   try{
    const challenge=await consumeChallenge(req.body?.requestId,'authenticate');
    if(!challenge)return res.status(400).json({error:'challenge_expired'});
    const credentialId=req.body?.response?.id;
    const q=await db.query('SELECT * FROM ceo_passkeys WHERE id=$1',[credentialId]);
    if(!q.rowCount)return res.status(401).json({error:'unknown_passkey'});
    const row=q.rows[0];
    const verification=await verifyAuthenticationResponse({response:req.body.response,expectedChallenge:challenge,expectedOrigin:origin(),expectedRPID:rpID(),requireUserVerification:true,credential:{id:row.id,publicKey:new Uint8Array(Buffer.from(row.public_key,'base64')),counter:Number(row.counter),transports:row.transports}});
    if(!verification.verified)return res.status(401).json({error:'passkey_verification_failed'});
    await db.query('UPDATE ceo_passkeys SET counter=$1 WHERE id=$2',[verification.authenticationInfo.newCounter,row.id]);
    await issueSession(res);
   }catch(e){console.error('passkey authentication:',e?.message);res.status(401).json({error:'passkey_authentication_failed'});}
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
