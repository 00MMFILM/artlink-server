const test=require('node:test'),assert=require('node:assert/strict');
const {makeHandler,_test}=require('../api/studio-transfer');
const C=require('../public/studio/transfer-contract');
const review=(field='music')=>({version:1,field,lang:'ko',title:'작업',role:'보컬',intent:'끝을 길게',notes:[{body:'비밀 메모 🌸',label:'A · 0:02',resolved:false}],settings:{start:2,end:4,rate:.75,offset:1,loop:true},...(field==='literature'?{texts:{a:'원문',b:'수정문'}}:{})});
function fixture(){
 let time=Date.parse('2026-10-23T00:00:00Z');const objects=new Map();
 const env={SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_KEY:'test-only-key',CRON_SECRET:'test-cron',NODE_ENV:'test'};
 const fetcher=async(url,o={})=>{
  const tail=url.split('/studio-transfers')[1]||'';
  if(url.includes('/object/list/')){const {prefix,limit}=JSON.parse(o.body);return new Response(JSON.stringify([...objects].filter(([p])=>p.startsWith(prefix+'/')).map(([p,v])=>({id:p,name:p.split('/').at(-1),created_at:v.at})).sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(0,limit)));}
  if(o.method==='DELETE'){for(const p of JSON.parse(o.body).prefixes)objects.delete(p);return new Response('{}');}
  const p=tail.slice(1);
  if(o.method==='POST'){if(objects.has(p))return new Response('already exists',{status:409});objects.set(p,{body:Buffer.from(o.body),at:new Date(time).toISOString()});return new Response('{}',{status:200});}
  return objects.has(p)?new Response(objects.get(p).body):new Response('not found',{status:404});
 };
 const handler=makeHandler({env,fetcher,now:()=>time});
 async function call(body,extra={}){let status,data,headers={};await handler({method:'POST',headers:{origin:'http://localhost','x-forwarded-for':'127.0.0.1',...extra.headers},body,...(extra.method?{method:extra.method}:{})},{setHeader:(k,v)=>headers[k]=v,set statusCode(v){status=v;},end:s=>data=JSON.parse(s)});return {status,data,headers};}
 return {call,objects,tick:ms=>{time+=ms;}};
}
test('six fields round-trip privately; immediate read/revoke; no original media',async()=>{
 for(const field of ['acting','music','art','dance','literature','film']){
  const f=fixture(),p={...review(field),images:['file:///private'],url:'https://private.test',filename:'secret.mov'};
  const created=await f.call({action:'create',review:p});assert.equal(created.status,201);
  const value=[...f.objects].find(([p])=>p.startsWith('reviews/'))[1].body;
  assert.equal(value.includes(Buffer.from('비밀 메모')),false);
  const read=await f.call({action:'read',code:created.data.code});assert.equal(read.status,200);assert.deepEqual(read.data.review,C.normalize(p));assert.match(read.data.id,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(read.data).includes('secret.mov'),false);
  assert.equal((await f.call({action:'revoke',code:created.data.code})).status,200);f.tick(1000);assert.equal((await f.call({action:'read',code:created.data.code})).status,404);
 }
});
test('expiry denies retrieval and sweep deletes abandoned transfers',async()=>{
 const f=fixture(),a=await f.call({action:'create',review:review()});f.tick(_test.TTL+1);assert.equal((await f.call({action:'read',code:a.data.code})).status,410);
 const b=await f.call({action:'create',review:review()});f.tick(_test.TTL+1);const swept=await f.call(null,{method:'GET',headers:{authorization:'Bearer test-cron'}});assert.equal(swept.status,200);assert.equal(f.objects.size,0);assert.equal((await f.call({action:'read',code:b.data.code})).status,404);
});
test('malicious origin, invalid payload, method and over-limit input rejected',async()=>{
 const f=fixture();assert.equal((await f.call({action:'create',review:review()},{headers:{origin:'https://evil.test'}})).status,403);
 assert.equal((await f.call({action:'create',review:{...review(),field:'unknown'}})).status,400);
 assert.equal((await f.call({action:'read',code:'../../private'})).status,400);
 assert.equal((await f.call({}, {method:'GET'})).status,405);
 assert.equal((await f.call({action:'create',review:{...review(),intent:'x'.repeat(600001)}})).status,413);
 assert.equal(f.objects.size,0);
});
test('atomic throttle permits first request and rejects bursts',async()=>{
 const f=fixture();assert.equal((await f.call({action:'create',review:review()})).status,201);assert.equal((await f.call({action:'create',review:review()})).status,429);f.tick(30000);assert.equal((await f.call({action:'create',review:review()})).status,201);
});
test('tampering and wrong codes cannot decrypt stored content',()=>{
 const p=review(),b=_test.encrypt('a'.repeat(24),p);assert.deepEqual(_test.decrypt('a'.repeat(24),b),p);assert.throws(()=>_test.decrypt('b'.repeat(24),b));b[30]^=1;assert.throws(()=>_test.decrypt('a'.repeat(24),b));
});
test('full draft and Unicode retained; strict bounds; shared code parsing',()=>{
 const p=review('literature');p.notes=Array.from({length:101},(_,i)=>({body:'초안 '+i,label:'원문',resolved:i%2===0}));p.texts.a='글'.repeat(20000);assert.equal(C.normalize(p).notes.length,101);assert.equal(C.normalize(p).texts.a.length,20000);assert.throws(()=>C.normalize({...p,texts:{a:'x'.repeat(20001),b:''}}));assert.throws(()=>C.normalize({...p,settings:{start:4,end:2}}));assert.equal(C.code('abcd-abcd-abcd-abcd-abcd-abcd'),'abcd'.repeat(6));
});
