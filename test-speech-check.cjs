const test = require('node:test');
const assert = require('node:assert/strict');
const { measure, wav, RATE } = require('./api/_speechSignal');
const { normalize, assess } = require('./api/_speechProvider');
const { makeHandler, decode } = require('./api/speech-check');
function tone(seconds, amplitude = 0.2) {
 const b = Buffer.alloc(Math.round(seconds * RATE) * 2);
 for(let i=0; i<b.length/2; i++) b.writeInt16LE(Math.round(32767 * amplitude * Math.sin(i * 2 * Math.PI * 180/RATE)), i*2);
 return b;
}
const input = () => ({ locale:'ko-KR', reference:'오늘은 여기까지.', consent:true, requestId:'11111111-1111-4111-8111-111111111111', audio:wav(tone(1)).toString('base64') });
const env={AZURE_SPEECH_KEY:'test-key',AZURE_SPEECH_REGION:'eastasia',SPEECH_SCORING_ENABLED:'true'};
function setup({limitError, authError, decoder=async()=>tone(1), assessor=async()=>({status:'assessed',words:[]}), configured=true}={}) {
 const calls=[];
 const db={auth:{getUser:async()=>authError?{error:{}}:{data:{user:{id:'trusted-user'}}}},rpc:async(name,p)=>{calls.push(p);return p.p_action==='reserve'&&limitError?{error:{message:limitError}}:{data:{used:1,limit:5,windowHours:24}};}};
 const handler=makeHandler({client:db,env:configured?env:{},decoder,assessor});
 const request=async(body=input(),headers={authorization:'Bearer test'})=>{
  let status,result;
  await handler({method:'POST',headers,body},{setHeader(){},status(s){status=s;return this;},json(b){result=b;return this;}});
  return {status,result};
 };
 return {request,calls};
}
test('PCM identifies a known quiet interval without calling it an accent error',()=>{
 const r=measure(Buffer.concat([tone(.5),tone(.5,0),tone(.5)]));
 assert.equal(r.duration,1.5); assert.equal(r.quiet.length,1); assert.ok(Math.abs(r.quiet[0].start-.5)<.03); assert.equal(r.warnings.length,0);assert.equal(r.pronunciation,undefined);
});
test('silence, quiet audio and clipping remain recording-quality notices',()=>{
 assert.deepEqual(measure(tone(1,0)).warnings,['NO_SIGNAL']);
 assert.deepEqual(measure(tone(1,.002)).warnings,['LOW_LEVEL']);
 assert.ok(measure(Buffer.alloc(RATE*2,127)).warnings.includes('CLIPPING'));
});
test('rejects too short and overlong audio instead of silently truncating',()=>{
 assert.throws(()=>measure(tone(.1)),/DURATION_LIMIT/);assert.throws(()=>measure(tone(30.1)),/DURATION_LIMIT/);
});
test('real ffmpeg decoding preserves silence location and duration',async()=>{
 const pcm=await decode(wav(Buffer.concat([tone(.5),tone(.5,0),tone(.5)])));
 assert.equal(measure(pcm).duration,1.5);assert.equal(measure(pcm).quiet.length,1);
 await assert.rejects(()=>decode(Buffer.from('not an audio file')));
});
test('real decoder rejects overlong content at the measurement boundary',async()=>{
 const pcm=await decode(wav(tone(32)));assert.throws(()=>measure(pcm),/DURATION_LIMIT/);
});
test('real AAC/M4A decoding preserves the quiet interval used by mobile recordings',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const {promisify}=require('node:util'),{execFile}=require('node:child_process');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'artlink-aac-test-'));
 try{
  const source=path.join(dir,'source.wav'),encoded=path.join(dir,'take.m4a');
  await fs.writeFile(source,wav(Buffer.concat([tone(.5),tone(.5,0),tone(.5)])));
  await promisify(execFile)(require('ffmpeg-static'),['-nostdin','-loglevel','error','-i',source,'-c:a','aac','-b:a','64k',encoded]);
  const measured=measure(await decode(await fs.readFile(encoded)));
  assert.ok(Math.abs(measured.duration-1.5)<.1);assert.equal(measured.quiet.length,1);
  assert.ok(Math.abs(measured.quiet[0].start-.5)<.1);assert.ok(Math.abs(measured.quiet[0].end-1)<.1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('API authenticates before decoding and does not accept body user identity',async()=>{
 let decoded=0;const s=setup({decoder:async()=>{decoded++;return tone(1);}});
 assert.equal((await s.request(input(),{})).status,401);assert.equal(decoded,0);
 assert.equal((await s.request({...input(),userId:'attacker'})).status,200);
 assert.ok(s.calls.every(c=>c.p_user==='trusted-user'));
 assert.equal((await setup({authError:true}).request()).status,401);
});
for(const [label,patch] of [['no consent',{consent:false}],['unsupported language',{locale:'fr-FR'}],['empty reference',{reference:' '}],['long reference',{reference:'x'.repeat(401)}],['nonbase64',{audio:'https://private'}],['large file',{audio:Buffer.alloc(2097153).toString('base64')}]])test('rejects '+label,async()=>{assert.equal((await setup().request({...input(),...patch})).status,400);});
test('quota errors stop processing, failed decodes release reservation',async()=>{
 let decoded=0;const s=setup({limitError:'SPEECH_LIMIT',decoder:async()=>{decoded++;}});
 assert.equal((await s.request()).status,429);assert.equal(decoded,0);
 const bad=setup({decoder:async()=>{throw Error('bad file');}});assert.equal((await bad.request()).status,400);assert.deepEqual(bad.calls.map(c=>c.p_action),['reserve','release']);
});
test('unconfigured pronunciation preserves measured signals without manufactured scores',async()=>{
 let called=false;const s=setup({configured:false,assessor:async()=>{called=true;}});
 const r=await s.request();assert.equal(r.status,200);assert.equal(called,false);assert.equal(r.result.pronunciation.status,'unavailable');assert.equal(r.result.signal.duration,1);
});
test('unusable signal never reaches the pronunciation provider',async()=>{
 let called=false;const r=await setup({decoder:async()=>tone(1,0),assessor:async()=>{called=true;}}).request();
 assert.equal(r.status,200);assert.equal(called,false);assert.equal(r.result.pronunciation.status,'needs_recording');
});
test('provider failure does not become a successful pronunciation judgment',async()=>{
 const r=await setup({assessor:async()=>{throw Error('upstream');}}).request();assert.equal(r.result.pronunciation.status,'failed');assert.equal(r.status,200);
});
const response=()=>({RecognitionStatus:'Success',NBest:[{Confidence:.9,PronunciationAssessment:{AccuracyScore:80,ProsodyScore:90},Words:[{Word:'오늘은',Offset:1000000,Duration:3000000,PronunciationAssessment:{AccuracyScore:60,ErrorType:'Mispronunciation'}}]}]});
test('provider normalization keeps time anchors and excludes Korean prosody',()=>{
 const ko=normalize(response(),'ko-KR',1);assert.equal(ko.words[0].start,.1);assert.equal(ko.words[0].end,.4);assert.equal(ko.prosody,null);
 assert.equal(normalize(response(),'en-US',1).prosody,90);
 const low=response();low.NBest[0].Confidence=.1;assert.equal(normalize(low,'en-US',1).status,'uncertain');
 assert.equal(normalize({RecognitionStatus:'NoMatch'},'ko-KR',1).status,'unrecognized');
 const invalid=response();invalid.NBest[0].Words[0].Offset=40000000;assert.equal(normalize(invalid,'ko-KR',1).status,'uncertain');
});
test('Azure request puts key in header, exact reference in encoded parameters and uses locale gating',async()=>{
 for(const locale of ['ko-KR','en-US']){
 let request;
 await assess({pcm:tone(1),duration:1,reference:'A "quoted" line',locale,env,fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>response()};}});
 assert.ok(!request.url.includes('test-key'));assert.equal(request.options.headers['Ocp-Apim-Subscription-Key'],'test-key');
 const p=JSON.parse(Buffer.from(request.options.headers['Pronunciation-Assessment'],'base64').toString());assert.equal(p.ReferenceText,'A "quoted" line');assert.equal(p.EnableProsodyAssessment,locale==='en-US');
 }
});
