// Local HTTP + real PostgreSQL + real audio decoding. Authentication is a
// test double, not a test of Supabase or the production service.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url), {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const {makeHandler}=require('../api/speech-check'),{wav}=require('../api/_speechSignal');
const user='00000000-0000-4000-8000-000000000001',db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to service_role;`);
await db.query('insert into auth.users values($1)',[user]);
await db.exec(fs.readFileSync(new URL('../migrations/2026-10-28-speech-check.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
const handler=makeHandler({env:{},client:{auth:{getUser:async token=>token==='local-only'?{data:{user:{id:user}}}:{error:{}}},rpc:async(_,p)=>{
 try{return {data:(await db.query('select public.artlink_speech_limit($1,$2,$3) r',[p.p_user,p.p_request,p.p_action])).rows[0].r};}catch(e){return {error:{message:e.message}};}
}}});
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 req.body=JSON.parse(body||'{}');res.status=s=>{res.statusCode=s;return res};res.json=b=>res.end(JSON.stringify(b));
 await handler(req,res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const pcm=Buffer.alloc(16000*2*2);
 for(let i=0;i<32000;i++)pcm.writeInt16LE(i>=8000&&i<16000?0:Math.round(6000*Math.sin(i*2*Math.PI*190/16000)),i*2);
 const response=await fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',headers:{Authorization:'Bearer local-only','Content-Type':'application/json'},body:JSON.stringify({audio:wav(pcm).toString('base64'),reference:'Local waveform fixture.',locale:'en-US',consent:true,requestId:'00000000-0000-4000-8000-000000000002'})});
 assert.equal(response.status,200);const r=await response.json();assert.equal(r.signal.duration,2);assert.equal(r.signal.quiet.length,1);assert.equal(r.pronunciation.status,'unavailable');assert.equal(r.quota.used,1);
 console.log('PASS local HTTP → verified test identity → PostgreSQL quota → real ffmpeg → signal result. No external speech provider call.');
}finally{await new Promise(r=>server.close(r));await db.close();}
