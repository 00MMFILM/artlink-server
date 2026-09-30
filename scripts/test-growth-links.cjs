const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [];
let fail = false;
const ctx = {module:{exports:{}}, URL, process:{env:{SUPABASE_URL:'https://offline.invalid',SUPABASE_SERVICE_KEY:'offline-placeholder'}},
  require: () => ({createClient:() => ({from: table => ({insert:async row => {calls.push({table,row});if(fail)throw Error('offline failure');}})})})};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/app.js'),'utf8'),ctx);
async function run(url, ua = 'desktop', method = 'GET', referer = '') {
  const res = {headers:{},setHeader(k,v){this.headers[k]=v;},end(){}};
  await ctx.module.exports({url,method,headers:{'user-agent':ua,referer}},res);
  return res;
}
(async () => {
  for(const [query,ua,target] of [
    ['?platform=ios','desktop','apps.apple.com'], ['?platform=android','desktop','play.google.com'],
    ['','iPhone','apps.apple.com'], ['','Android','play.google.com'], ['','desktop','art-link.kr'],
    ['?platform=https://evil.invalid','desktop','art-link.kr'], ['?platform=ios','Android','apps.apple.com'],
  ]) {
    const r = await run('/app'+query,ua); assert.equal(r.statusCode,302); assert.equal(new URL(r.headers.Location).hostname,target); assert.equal(r.headers['Cache-Control'],'no-store');
  }
  await run('/app?s=instagram_bio_footer&platform=ios','desktop','GET','https://art-link.kr/launch/?email=private#secret');
  assert.equal(calls.at(-1).row.source,'instagram_bio_footer');
  assert.equal(calls.at(-1).row.referer,'https://art-link.kr/launch/');
  for(const bad of ['my@email.com','a'.repeat(41),'https://evil.invalid']) {
    await run('/app?s='+encodeURIComponent(bad)); assert.equal(calls.at(-1).row.source,'direct');
  }
  const count = calls.length;
  await run('/app?platform=ios','previewbot'); await run('/app?platform=ios','desktop','HEAD');
  assert.equal(calls.length,count,'previews and HEAD requests do not count as a store click');
  const invalid = await run('/app','desktop','POST'); assert.equal(invalid.statusCode,405);assert.equal(calls.length,count);
  const IG='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0.0.0';
  let ig = await run('/app',IG); assert.equal(ig.headers.Location,'https://art-link.kr/launch/?s=instagram_bio','bare bio link from Instagram opens the landing'); assert.equal(calls.at(-1).row.source,'instagram_bio');
  ig = await run('/app?platform=ios',IG); assert.equal(new URL(ig.headers.Location).hostname,'apps.apple.com','explicit store buttons inside Instagram still go to the store');
  ig = await run('/app?s=reel_42',IG); assert.equal(new URL(ig.headers.Location).hostname,'apps.apple.com','campaign links keep their store destination');
  ig = await run('/app','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'); assert.equal(new URL(ig.headers.Location).hostname,'apps.apple.com','non-Instagram bare link unchanged');
  fail = true; assert.equal((await run('/app?platform=ios')).statusCode,302,'analytics failure cannot block installation');
  console.log('PASS: store selection, fixed destinations, attribution, referrer privacy, bot/HEAD filtering, analytics outage');
})().catch(e=>{console.error(e);process.exitCode=1;});
