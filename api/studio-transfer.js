// Private, opt-in handoff. No artwork/media, public URLs, or request-body logging.
const crypto = require('node:crypto');
const contract = require('../public/studio/transfer-contract');
const BUCKET = 'studio-transfers';
const MAX_BYTES = 600000;
const TTL = 24 * 60 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const objectPath = code => 'reviews/' + digest(code);
const day = now => new Date(now).toISOString().slice(0,10);
function cipherKey(code){return crypto.createHash('sha256').update('artlink-studio-v1:'+code).digest();}
function encrypt(code,value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',cipherKey(code),iv);const b=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);}
function decrypt(code,value){const b=Buffer.from(value),c=crypto.createDecipheriv('aes-256-gcm',cipherKey(code),b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8'));}
function storage(env,fetcher){
 const base=env.SUPABASE_URL+'/storage/v1',headers={apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY};
 return {
  async put(path,body){return fetcher(base+'/object/'+BUCKET+'/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','x-upsert':'false'},body});},
  async get(path){return fetcher(base+'/object/'+BUCKET+'/'+path,{headers});},
  async remove(paths){if(!paths.length)return;const r=await fetcher(base+'/object/'+BUCKET,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths})});if(!r.ok)throw Error('STORAGE_UNAVAILABLE');},
  async list(prefix,offset=0){const r=await fetcher(base+'/object/list/'+BUCKET,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'created_at',order:'asc'}})});if(!r.ok)throw Error('STORAGE_UNAVAILABLE');return r.json();}
 };
}
function makeHandler({env=process.env,fetcher=fetch,now=Date.now}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_KEY)return send(503,{error:'UNAVAILABLE'});
  const store=storage(env,fetcher);
  // Daily sweep removes expired encrypted copies, including abandoned transfers.
  if(req.method==='GET'&&req.headers.authorization&&env.CRON_SECRET&&req.headers.authorization==='Bearer '+env.CRON_SECRET){
   try{let removed=0;for(const prefix of ['reviews','limits']){for(let pass=0;pass<20;pass++){const rows=await store.list(prefix);const expired=rows.filter(r=>r.id&&Date.parse(r.created_at)<now()-TTL).map(r=>prefix+'/'+r.name);if(!expired.length)break;await store.remove(expired);removed+=expired.length;}}return send(200,{removed});}catch{return send(503,{error:'UNAVAILABLE'});}
  }
  if(req.method!=='POST')return send(405,{error:'METHOD_NOT_ALLOWED'});
  const origin=req.headers.origin;
  if(origin&&origin!=='https://art-link.kr'&&origin!=='https://www.art-link.kr'&&origin!==`https://${env.VERCEL_URL}`&&!(env.NODE_ENV==='test'&&origin==='http://localhost'))return send(403,{error:'ORIGIN_DENIED'});
  let b=req.body;
  try{if(typeof b==='string'){if(Buffer.byteLength(b)>MAX_BYTES)return send(413,{error:'TOO_LARGE'});b=JSON.parse(b);}if(!b||Buffer.byteLength(JSON.stringify(b))>MAX_BYTES)return send(413,{error:'TOO_LARGE'});}catch{return send(400,{error:'INVALID_REVIEW'});}
  try{
   // Separate atomic slots per action and IP, atomic across serverless instances. No IP stored.
   const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
   const hashed=crypto.createHmac('sha256',env.SUPABASE_SERVICE_KEY).update(ip+day(now())).digest('hex');
   if(!['create','read','revoke'].includes(b.action))return send(400,{error:'INVALID_ACTION'});
   const c=b.action==='create'?null:contract.code(b.code);
   if(b.action!=='create'&&!c)return send(400,{error:'INVALID_CODE'});
   const payload=b.action==='create'?contract.normalize(b.review):null;
   const slot=await store.put(`limits/${hashed}-${b.action}-${Math.floor(now()/(b.action==='create'?30000:1000))}`,Buffer.from('1'));
   if(!slot.ok){const text=await slot.text();if(slot.status===409||/duplicate|already exists/i.test(text))return send(429,{error:'TRY_AGAIN',retryAfter:b.action==='create'?30:1});return send(503,{error:'UNAVAILABLE'});}
   if(b.action==='create'){
    const code=crypto.randomBytes(12).toString('hex'),id=digest(code),expiresAt=now()+TTL;
    const saved=await store.put(objectPath(code),encrypt(code,{id,expiresAt,review:payload}));
    if(!saved.ok)return send(503,{error:'UNAVAILABLE'});
    return send(201,{code,expiresAt});
   }
   if(b.action==='revoke'){await store.remove([objectPath(c)]);return send(200,{revoked:true});}
   const found=await store.get(objectPath(c));
   if(!found.ok)return send(found.status===404||found.status===400?404:503,{error:found.status===404||found.status===400?'NOT_FOUND':'UNAVAILABLE'});
   const value=decrypt(c,await found.arrayBuffer());
   if(value.expiresAt<=now()){await store.remove([objectPath(c)]);return send(410,{error:'EXPIRED'});}
   return send(200,{...value,review:contract.normalize(value.review)});
  }catch(e){return send(['INVALID_REVIEW','EMPTY_REVIEW'].includes(e.message)?400:503,{error:['INVALID_REVIEW','EMPTY_REVIEW'].includes(e.message)?e.message:'UNAVAILABLE'});}
 };
}
module.exports=makeHandler();
module.exports.makeHandler=makeHandler;
module.exports._test={encrypt,decrypt,objectPath,TTL};
