import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=createRequire(import.meta.url)(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const db=new PGlite();const user='00000000-0000-4000-8000-000000000001';let checks=0;
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to service_role,authenticated,anon;`);
await db.query('insert into auth.users values($1)',[user]);
await db.exec(fs.readFileSync(new URL('../migrations/2026-10-28-speech-check.sql',import.meta.url),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function call(n,a){return (await db.query('select public.artlink_speech_limit($1,$2,$3) result',[user,id(n),a])).rows[0].result;}
await db.exec('set role anon');await assert.rejects(()=>call(1,'reserve'),/permission denied/);checks++;
await db.exec('reset role;set role authenticated');await assert.rejects(()=>db.query('select * from public.artlink_speech_usage'),/permission denied/);checks++;
await assert.rejects(()=>call(1,'reserve'),/permission denied/);checks++;
await db.exec('reset role;set role service_role');
// The public catalog readiness probe must neither reserve nor charge a check.
const {makeHandler}=createRequire(import.meta.url)('../api/speech-compare');
let catalog;
const handler=makeHandler({env:{OPENAI_API_KEY:'test'},loadCatalog:async()=>({drills:[]}),client:{rpc:async(_,p)=>{
 try{return {data:(await db.query('select public.artlink_speech_limit($1,$2,$3) result',[p.p_user,p.p_request,p.p_action])).rows[0].result};}
 catch(e){return {error:{message:e.message}};}
}}});
await handler({method:'GET'},{setHeader(){},status(){return this;},json(body){catalog=body;}});
assert.equal(catalog.available,true);checks++;
assert.equal((await db.query('select count(*)::int n from public.artlink_speech_usage')).rows[0].n,0);checks++;
assert.equal((await call(1,'reserve')).used,1);checks++;
await assert.rejects(()=>call(1,'reserve'),/SPEECH_BUSY/);checks++;
assert.equal((await call(1,'release')).used,0);checks++;
for(let n=1;n<=5;n++){await call(n,'reserve');await call(n,'complete');}
await assert.rejects(()=>call(6,'reserve'),/SPEECH_LIMIT/);checks++;
assert.equal((await call(1,'release')).used,5);checks++;
await db.exec("reset role;update public.artlink_speech_usage set created_at=now()-interval '25 hours';set role service_role");assert.equal((await call(7,'reserve')).used,1);checks++;
await db.exec("reset role;update public.artlink_speech_usage set created_at=now()-interval '3 minutes';set role service_role");assert.equal((await call(8,'reserve')).used,1);checks++;
await db.exec('reset role');await db.query('delete from auth.users where id=$1',[user]);assert.equal((await db.query('select count(*)::int n from public.artlink_speech_usage')).rows[0].n,0);checks++;
await db.close();console.log(`PASS ${checks} speech quota PostgreSQL checks`);
