// 실제 PostgreSQL 프로세스 검증. 운영 접속정보를 읽지 않고 임시 DB/Unix 소켓만 사용한다.
// 외부 런타임: ARTLINK_PG_RUNTIME=<임시 npm prefix> node scripts/test-profile-atomic-postgres.mjs
// prefix에 @embedded-postgres/darwin-arm64@17.10.0-beta.17, pg@8.23.0 설치 필요.
// 기본 테스트 목록과 분리되어 있으며 실행하면 자체 로컬 DB만 생성/종료한다.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { levelForMileage } from "../api/_mileage.js";

const runtime = process.env.ARTLINK_PG_RUNTIME;
if (!runtime) throw new Error("Set ARTLINK_PG_RUNTIME to an isolated test-runtime directory; no production URL accepted.");
const bin = join(runtime, "node_modules/@embedded-postgres/darwin-arm64/native/bin");
const { default: pg } = await import(pathToFileURL(join(runtime, "node_modules/pg/lib/index.js")));
const root = mkdtempSync("/tmp/artlink-pg-");
const data = join(root, "data"), socket = join(root, "socket");
mkdirSync(socket, { mode: 0o700 });
const options = { host: socket, port: 55439, user: "artlink_test", database: "postgres", password: "", application_name: "artlink-local-regression" };
let started = false;
const clients = [];
const client = async (name) => {
  const c = new pg.Client({ ...options, application_name: name }); clients.push(c); await c.connect(); return c;
};
const U = "11111111-1111-4111-8111-111111111111";
const T1 = "2026-09-20T00:00:00Z", T2 = "2026-09-21T00:00:00Z", T3 = "2026-09-22T00:00:00Z";
const payload = { name: "합성 배우", email: "actor@example.invalid", bio: "합성 소개", photo_url: "synthetic-photo", photos: ["synthetic-photo"], score: 70, mileage: 1333, notes_count: 4 };
const rpc = async (c, mode, pub = null, ts = null, row = {}, id = U) =>
  (await c.query("SELECT public.sync_artist_profile_atomic($1,$2,$3::jsonb,$4,$5::timestamptz) AS result", [id, mode, JSON.stringify(row), pub, ts])).rows[0].result;
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
try {
  execFileSync(join(bin, "initdb"), ["-D", data, "-A", "trust", "-U", "artlink_test", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
  execFileSync(join(bin, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-k ${socket} -h '' -p 55439`, "-w", "start"], { stdio: "pipe" });
  started = true;
  const admin = await client("artlink-admin"), a = await client("artlink-a"), b = await client("artlink-b");
  console.log((await admin.query("SELECT version() AS version")).rows[0].version);
  // 운영 DDL은 조회하지 않았다. 합성 스키마는 JSONB/SQL 배열 두 컬럼 타입을 포함한다.
  await admin.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.users(id uuid PRIMARY KEY);
    INSERT INTO public.users VALUES ('${U}');
    CREATE TABLE public.artist_profiles (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid UNIQUE NOT NULL REFERENCES public.users(id),
      name text NOT NULL DEFAULT '익명', email text, user_type text, fields text[] DEFAULT '{}', gender text,
      birth_date date, height numeric, weight numeric, height_private boolean DEFAULT false, weight_private boolean DEFAULT false,
      specialties text[] DEFAULT '{}', school text, location text, agency text, career jsonb DEFAULT '[]', bio text,
      role_models text[] DEFAULT '{}', interests text[] DEFAULT '{}', photo_url text, photos jsonb DEFAULT '[]',
      notes_count integer DEFAULT 0, streak_days integer DEFAULT 0, score integer DEFAULT 0,
      mileage integer DEFAULT 0, level integer DEFAULT 1, profile_public boolean NOT NULL DEFAULT true,
      visibility_updated_at timestamptz, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
    );
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.artist_profiles TO service_role;
  `);
  const sql = readFileSync(new URL("../migrations/2026-09-26-profile-sync-atomic.sql", import.meta.url), "utf8");
  await admin.query(sql);
  await admin.query(sql); // 재적용 가능성도 검사한다.
  await a.query("SET ROLE service_role"); await b.query("SET ROLE service_role");
  const reset = () => admin.query("DELETE FROM public.artist_profiles");
  const get = async () => (await admin.query("SELECT * FROM public.artist_profiles WHERE user_id=$1", [U])).rows[0];
  const privateRow = row => { assert.equal(row.profile_public, false); assert.equal(row.email, null); assert.equal(row.bio, null); assert.equal(row.photo_url, null); assert.deepEqual(row.photos, []); };
  async function awaitLock(c) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { rows } = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [c.processID]);
      if (rows[0]?.wait_event_type === "Lock") return;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error("second transaction did not wait on a database lock");
  }
  // 첫 호출을 COMMIT 전에 붙잡고 두 번째 호출이 실제 DB 잠금을 기다리는지 확인한다.
  async function concurrent(first, second, verify) {
    await a.query("BEGIN"); await first(a);
    const pending = second(b); await awaitLock(b);
    await a.query("COMMIT"); const result = await pending; await verify(result, await get());
  }
  await test("only service_role can execute RPC; anon/authenticated are denied", async () => {
    const sig = "public.sync_artist_profile_atomic(text,text,jsonb,boolean,timestamptz)";
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await admin.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, sig])).rows[0].allowed, false);
      await admin.query(`SET ROLE ${role}`);
      await assert.rejects(rpc(admin, "visibility", false, T2), e => e.code === "42501");
      await admin.query("RESET ROLE");
    }
    assert.equal((await admin.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS allowed", [sig])).rows[0].allowed, true);
  });
  await test("missing row OFF locks before late ON and persists a private tombstone", async () => {
    await reset();
    await concurrent(c => rpc(c, "visibility", false, T2), c => rpc(c, "full", true, T1, payload), (r,row) => { assert.equal(r.ignored,"stale_visibility"); privateRow(row); });
  });
  await test("missing row ON first then newer OFF clears private data", async () => {
    await reset();
    await concurrent(c => rpc(c,"full",true,T1,payload), c => rpc(c,"visibility",false,T2), (_r,row) => { privateRow(row); assert.equal(row.score,70); assert.equal(row.mileage,1333); assert.equal(row.level,6); });
  });
  await test("existing OFF first prevents in-flight full upload from restoring contents", async () => {
    await reset(); await rpc(a,"full",true,T1,payload);
    await concurrent(c => rpc(c,"visibility",false,T2), c => rpc(c,"full",true,T1,{...payload,score:99}), (r,row) => { assert.equal(r.ignored,"stale_visibility"); privateRow(row); assert.equal(row.score,70); });
  });
  await test("OFF first prevents in-flight photos from restoring private images", async () => {
    await reset(); await rpc(a,"full",true,T1,payload);
    await concurrent(c => rpc(c,"visibility",false,T2), c => rpc(c,"photos",null,null,{photos:["late"],photo_url:"late"}), (r,row) => { assert.equal(r.ignored,"stale_visibility"); privateRow(row); });
  });
  await test("photos first then OFF still removes private images", async () => {
    await reset(); await rpc(a,"full",true,T1,payload);
    await concurrent(c => rpc(c,"photos",null,null,{photos:["early"],photo_url:"early"}), c => rpc(c,"visibility",false,T2), (_r,row) => privateRow(row));
  });
  await test("newer ON wins over delayed OFF and full upload at same timestamp still works", async () => {
    await reset(); await rpc(a,"visibility",false,T2);
    await concurrent(c => rpc(c,"visibility",true,T3), c => rpc(c,"visibility",false,T2), (r,row) => { assert.equal(r.ignored,"stale_visibility"); assert.equal(row.profile_public,true); });
    await rpc(a,"full",true,T3,payload); assert.equal((await get()).name,payload.name);
  });
  await test("fresh timestamp without explicit ON cannot restore a private profile", async () => {
    await reset(); await rpc(a,"visibility",false,T2);
    assert.equal((await rpc(a,"full",null,T3,payload)).ignored,"stale_visibility"); privateRow(await get());
    assert.equal((await rpc(a,"full",true,T2,payload)).ignored,"stale_visibility"); privateRow(await get());
  });
  await test("concurrent stale calculated totals cannot decrease saved score/mileage/level", async () => {
    await reset(); await rpc(a,"full",true,T1,payload);
    await concurrent(c => rpc(c,"full",true,T1,{...payload,score:88,mileage:1406}), c => rpc(c,"full",true,T1,{...payload,score:50,mileage:600}), (r,row) => { assert.equal(row.score,88); assert.equal(row.mileage,1406); assert.equal(row.level,7); assert.equal(r.mileage,1406); });
  });
  await test("legacy profile delete serializes with late full upload and leaves tombstone", async () => {
    await reset(); await rpc(a,"full",true,T1,payload);
    await concurrent(c => rpc(c,"delete"), c => rpc(c,"full",true,T1,payload), (r,row) => { assert.equal(r.ignored,"stale_visibility"); privateRow(row); });
  });
  await test("new ON-only preserves no_profile contract without creating an empty public row", async () => {
    await reset(); await rpc(a,"visibility",true,T3);
    const res = await rpc(a,"visibility",true,T3); assert.equal(res.ignored,"no_profile"); assert.equal(await get(),undefined);
  });
  await test("SQL mileage levels match existing JavaScript at threshold boundaries", async () => {
    for (const mileage of [0,45,49,50,149,150,299,300,536,971,1050,1333,1399,1400,1406,1487,2750]) {
      await reset(); const result = await rpc(a,"full",true,T1,{...payload,mileage});
      assert.equal(result.level,levelForMileage(mileage),`mileage=${mileage}`);
    }
  });
  await test("server-generated OFF uses millisecond precision and is newer to JavaScript Date.parse", async () => {
    // 기존 데이터의 마이크로초까지 포함해 앱에서 동률로 해석하지 않고 최신 OFF를 인식하는지 확인한다.
    const previous = "2099-01-01T00:00:00.123999Z";
    for (const mode of ["delete", "visibility"]) {
      await reset(); await rpc(a,"full",true,previous,payload);
      const result = await rpc(a,mode,false,null);
      assert.ok(Date.parse(result.visibilityUpdatedAt) > Date.parse(previous));
      assert.equal(Date.parse(result.visibilityUpdatedAt) - Date.parse(previous),1);
      assert.equal((await admin.query("SELECT mod(extract(microseconds FROM visibility_updated_at)::integer,1000) AS remainder FROM public.artist_profiles WHERE user_id=$1",[U])).rows[0].remainder,0);
      privateRow(await get());
    }
    await reset(); await rpc(a,"visibility",false,null);
    assert.equal((await admin.query("SELECT mod(extract(microseconds FROM visibility_updated_at)::integer,1000) AS remainder FROM public.artist_profiles WHERE user_id=$1",[U])).rows[0].remainder,0);
  });
  await test("unrelated user is not blocked by one user's lock", async () => {
    const other = "22222222-2222-4222-8222-222222222222"; await admin.query("INSERT INTO public.users VALUES ($1)",[other]);
    await a.query("BEGIN"); await rpc(a,"visibility",false,T3);
    const result = await rpc(b,"visibility",false,T2,{},other); assert.equal(result.profilePublic,false); await a.query("COMMIT");
  });
  console.log(`ALL PASS: ${passed} real PostgreSQL scenarios. Synthetic schema only; production schema/config not inspected.`);
} finally {
  for (const c of clients) { try { await c.end(); } catch {} }
  if (started) execFileSync(join(bin,"pg_ctl"),["-D",data,"-m","immediate","-w","stop"],{stdio:"pipe"});
  console.log("Local test cluster stopped; synthetic test files retained:",root);
}
