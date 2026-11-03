import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStagingEnvironment } from '../scripts/preflight.js';

const valid={
 DATABASE_URL:'postgresql://user:secret@db.example.org:5432/skai',
 DATABASE_SSL:'true',
 SKAI_CEO_PASSWORD:'test-ceo-password-at-least-16',
 SKAI_ADMIN_TOKEN:'abcdefghijklmnopqrstuvwxyz_123456789',
 OPENAI_API_KEY:'sk-test-placeholder-from-test-not-valid',
 NODE_ENV:'production',
 PUBLIC_ORIGIN:'https://skai-staging.example.org',
 SKAI_DAILY_AI_CALL_LIMIT:'5'
};
test('staging preflight accepts valid non-secret shape without connecting',()=>{
 const result=checkStagingEnvironment(valid);
 assert.ok(result.every(x=>x.ok),JSON.stringify(result));
});
test('staging preflight blocks missing secrets, HTTP origin and TLS disabled',()=>{
 const result=checkStagingEnvironment({...valid,DATABASE_SSL:'false',OPENAI_API_KEY:'replace-with-api-key',PUBLIC_ORIGIN:'http://localhost:8787'});
 assert.ok(result.some(x=>x.name==='DATABASE_SSL'&&!x.ok));
 assert.ok(result.some(x=>x.name==='OPENAI_API_KEY'&&!x.ok));
 assert.ok(result.some(x=>x.name==='PUBLIC_ORIGIN'&&!x.ok));
 assert.ok(result.some(x=>x.name==='SKAI_ADMIN_TOKEN'&&x.ok));
});
test('staging preflight reports only labels and human guidance, never secret values',()=>{
 const result=JSON.stringify(checkStagingEnvironment(valid));
 for(const key of [valid.DATABASE_URL,valid.SKAI_CEO_PASSWORD,valid.SKAI_ADMIN_TOKEN,valid.OPENAI_API_KEY])
  assert.ok(!result.includes(key));
});
test('AI daily call limit is bounded in staging preflight',()=>{
 const result=checkStagingEnvironment({...valid,SKAI_DAILY_AI_CALL_LIMIT:'100'});
 assert.equal(result.find(x=>x.name==='SKAI_DAILY_AI_CALL_LIMIT').ok,false);
});
