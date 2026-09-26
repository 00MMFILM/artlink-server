// API 경계 회귀. RPC 응답을 모킹하며 실제 SQL/동시성은 test-profile-atomic-postgres.mjs에서 검증한다.
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.PROFILE_SECRET = "test-profile-secret";
process.env.APP_SECRET = "";
let calls = [], failure = null, result = { ok: true }, unsafe = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith("/rpc/sync_artist_profile_atomic")) {
    calls.push(JSON.parse(init.body));
    return failure ? json(failure, 503) : json(result);
  }
  if (u.pathname.endsWith("/users")) return json(null); // 서버 노트 없음 → 계산값 없음
  if (u.pathname.endsWith("/user_notes")) return json([]);
  unsafe++;
  throw new Error("Unexpected direct profile access blocked");
};
const { makeProfileToken } = await import("../api/_profileLib.js");
const { default: sync } = await import("../api/profile-sync.js");
const { default: hide } = await import("../api/profile-delete.js");
const USER = "11111111-1111-4111-8111-111111111111";
const T = "2026-09-22T00:00:00.000Z";
const res = () => ({ code:0, body:null, setHeader(){}, status(c){this.code=c;return this;}, json(b){this.body=b;return this;}, end(){return this;} });
async function run(profile, { handler = sync, token = makeProfileToken(USER), extra = {} } = {}) {
  const r = res(); await handler({method:"POST",headers:{},body:{userId:USER,profileToken:token,profile,...extra}},r); return r;
}
function reset(reply = {ok:true}) { calls=[];failure=null;result=reply;unsafe=0; }
let passed = 0;
async function test(name, fn) { reset(); await fn(); passed++; console.log("PASS",name); }
await test("OFF-only uses atomic RPC even without a previously published row", async () => {
  result={ok:true,profilePublic:false,visibilityUpdatedAt:T};
  const r=await run({_visibilityOnly:true,profilePublic:false,visibilityUpdatedAt:T});
  assert.equal(r.code,200);assert.deepEqual(r.body,result);assert.equal(calls.length,1);
  assert.equal(calls[0].p_mode,"visibility");assert.equal(calls[0].p_requested_public,false);assert.equal(calls[0].p_requested_at,T);
});
await test("full profile sends calculated candidates; response uses locked DB totals and visibility", async () => {
  result={ok:true,score:88,mileage:1406,level:7,profilePublic:true,visibilityUpdatedAt:T};
  const r=await run({name:"합성",score:50,mileage:600,profilePublic:true,visibilityUpdatedAt:Date.parse(T)});
  assert.equal(r.code,200);assert.deepEqual(r.body,result);assert.equal(calls[0].p_mode,"full");
  assert.equal(calls[0].p_profile.score,50);assert.equal(calls[0].p_profile.mileage,600);assert.equal(calls[0].p_requested_at,T);
});
await test("OFF full request does not forward identifying profile contents", async () => {
  await run({profilePublic:false,visibilityUpdatedAt:T,name:"private",email:"private@example.invalid",photos:["private"]});
  assert.equal(calls[0].p_mode,"full");assert.deepEqual(calls[0].p_profile,{});
});
await test("photos use the same RPC and honor its private-state decision", async () => {
  result={ok:true,ignored:"stale_visibility",profilePublic:false,visibilityUpdatedAt:T};
  const r=await run({_photosOnly:true,photos:["late"],photoUrl:"late"});
  assert.deepEqual(r.body,result);assert.equal(calls[0].p_mode,"photos");
  assert.deepEqual(calls[0].p_profile,{photos:["late"],photo_url:"late"});
});
await test("ON-only preserves authoritative ignored/no_profile response", async () => {
  result={ok:true,ignored:"no_profile"};
  const r=await run({_visibilityOnly:true,profilePublic:true,visibilityUpdatedAt:T});
  assert.deepEqual(r.body,result);assert.equal(calls[0].p_mode,"visibility");
});
await test("legacy delete uses atomic tombstone mode without a direct DELETE", async () => {
  result={ok:true,profilePublic:false,visibilityUpdatedAt:T};
  const r=await run(undefined,{handler:hide}); assert.equal(r.code,200);assert.deepEqual(r.body,result);
  assert.equal(calls[0].p_mode,"delete");assert.equal(calls[0].p_requested_at,null);
});
await test("RPC absent, schema absent, and transient failures all close every write route", async () => {
  for (const code of ["PGRST202","42703","XX000"]) {
    for (const profile of [{_visibilityOnly:true,profilePublic:false},{_photosOnly:true,photos:["x"]},{name:"x"}]) {
      failure={code,message:"synthetic unavailable"};const r=await run(profile);
      assert.equal(r.code,503);assert.equal(r.body.retryable,true);
    }
    const r=await run(undefined,{handler:hide});assert.equal(r.code,503);
  }
  assert.equal(unsafe,0);
});
await test("invalid ownership cannot reach RPC from sync or legacy delete", async () => {
  assert.equal((await run({name:"x"},{token:"bad"})).code,403);
  assert.equal((await run(undefined,{token:"bad",handler:hide})).code,403);assert.equal(calls.length,0);
});
await test("malformed intent and timestamp fail before RPC", async () => {
  for (const visibilityUpdatedAt of ["bad",1e100,{},[],[1790431800123],["1790431800123"],true,false]) {
    assert.equal((await run({profilePublic:false,visibilityUpdatedAt})).code,400);
  }
  assert.equal((await run({_visibilityOnly:true})).code,400);assert.equal(calls.length,0);
});
await test("malformed RPC response cannot be acknowledged as success", async () => {
  result=null;const r=await run({name:"x"});assert.equal(r.code,503);assert.equal(unsafe,0);
});
console.log(`ALL PASS: ${passed} API boundary scenarios (SQL behavior tested separately)`);
