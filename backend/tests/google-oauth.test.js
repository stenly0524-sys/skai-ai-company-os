import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptRefreshToken,decryptRefreshToken,googleOAuthRouter} from '../src/google-oauth.js';
const key='ab'.repeat(32);
test('OAuth refresh token AES-GCM decrypts and authenticates',()=>{
 const encrypted=encryptRefreshToken('refresh-with-high-entropy',key);
 assert.notEqual(encrypted,'refresh-with-high-entropy');
 assert.equal(decryptRefreshToken(encrypted,key),'refresh-with-high-entropy');
 assert.throws(()=>decryptRefreshToken(encrypted,'cd'.repeat(32)));
 assert.throws(()=>decryptRefreshToken(encrypted.slice(0,-1)+'X',key));
});
test('OAuth requires protected and public callback routes',()=>{
 const oauth=googleOAuthRouter({query:async()=>({rows:[],rowCount:0})});
 const publicPaths=oauth.publicCallback.stack.map(s=>s.route?.path).filter(Boolean);
 const protectedPaths=oauth.protectedApi.stack.map(s=>s.route?.path).filter(Boolean);
 assert.deepEqual(publicPaths,['/callback']);
 assert.deepEqual(protectedPaths,['/status','/start','/disconnect']);
});
