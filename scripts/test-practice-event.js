// api/practice-event.js 회귀 테스트 (외부 네트워크·실 Supabase 없음).
// 실행: node scripts/test-practice-event.js
// (a) 정상 2건 → accepted 2, duplicates 0
// (b) 같은 clientEventId 재전송(배치 2건 중 1건이 이미 있던 것) → duplicates 1
// (c) 본문류 필드(content) 포함 → 400
// (d) 51건 → 400
// (e) 잘못된 event 값 → 400
// (f) X-App-Token 없음 → 401 (DB 호출 전에 막혀야 함)
// (h) practice_abandoned + elapsedMs → 200, elapsed_ms가 그대로 실린다
// (i) elapsedMs가 정수·0 이상·24시간 이하가 아니면 400
// (j) elapsed_ms 컬럼이 아직 없으면(42703) 그 필드만 빼고 재시도해 200
// (k) event CHECK에 practice_abandoned가 아직 없으면(23514) 그 건만 빼고 재시도해 200
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.APP_SECRET = "test-secret";

let upsertCalls = 0;
let lastBody = null;
let bodies = []; // 재시도 검증용 — upsert 호출마다의 요청 본문
let nextUpsertRows = []; // 다음 upsert 응답으로 돌려줄 "실제 삽입된" 행들
let nextErrors = []; // 앞에서부터 하나씩 꺼내 쓰는 PostgREST 오류 (비면 성공 응답)

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const method = (init.method || "GET").toUpperCase();
  if (u.pathname.includes("/practice_events") && method === "POST") {
    upsertCalls++;
    lastBody = JSON.parse(init.body || "[]");
    bodies.push(lastBody);
    const err = nextErrors.shift();
    if (err) {
      return new Response(JSON.stringify(err), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(nextUpsertRows), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }
  // identifyUser는 Authorization 헤더가 없으면 fetch를 호출하지 않으므로
  // 이 테스트에서는 그 외 경로를 탈 일이 없다.
  throw new Error("unexpected fetch: " + method + " " + u.pathname);
};

const { default: handler } = await import("../api/practice-event.js");

function mockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = (c) => {
    r.code = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  r.end = () => r;
  return r;
}

let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

const APP_HEADERS = { "x-app-token": "test-secret" };

function validEvent(overrides = {}) {
  return {
    clientEventId: "11111111-1111-4111-8111-111111111111",
    sessionId: "22222222-2222-4222-8222-222222222222",
    event: "practice_completed",
    kind: "text",
    subjectKey: "note-1",
    field: "연기",
    occurredAt: "2026-09-13T01:00:00.000Z",
    deviceId: "dev-1",
    language: "ko",
    platform: "ios",
    appVersion: "1.11.3",
    ...overrides,
  };
}

function uuidN(n) {
  const h = String(n).padStart(1, "0");
  return `${h.repeat(8).slice(0, 8)}-${h.repeat(4).slice(0, 4)}-4${h.repeat(3).slice(0, 3)}-8${h.repeat(3).slice(0, 3)}-${h.repeat(12).slice(0, 12)}`;
}

function req(events) {
  return { method: "POST", headers: { ...APP_HEADERS }, body: { events } };
}

// (a) 정상 2건
{
  upsertCalls = 0;
  nextUpsertRows = [{ id: 1 }, { id: 2 }];
  const events = [
    validEvent({ clientEventId: uuidN(1) }),
    validEvent({ clientEventId: uuidN(2), event: "practice_started" }),
  ];
  const res = mockRes();
  await handler(req(events), res);
  check("(a) 정상 2건 → 200", res.code === 200, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(a) accepted=2, duplicates=0", res.body?.accepted === 2 && res.body?.duplicates === 0, JSON.stringify(res.body));
  check("(a) upsert가 정확히 1회 호출됨(배치 1콜)", upsertCalls === 1, `calls=${upsertCalls}`);
}

// (b) 배치 2건 중 1건이 이미 존재(중복) → DB가 실제 삽입된 1건만 돌려준다고 가정
{
  upsertCalls = 0;
  nextUpsertRows = [{ id: 3 }]; // 2건 요청했지만 1건만 실제 삽입됨
  const events = [validEvent({ clientEventId: uuidN(3) }), validEvent({ clientEventId: uuidN(4) })];
  const res = mockRes();
  await handler(req(events), res);
  check("(b) 200 응답", res.code === 200, `code=${res.code}`);
  check("(b) accepted=1, duplicates=1", res.body?.accepted === 1 && res.body?.duplicates === 1, JSON.stringify(res.body));
}

// (c) 본문류 필드(content) 포함 → 400, DB 호출 없음
{
  upsertCalls = 0;
  const events = [validEvent({ clientEventId: uuidN(5), content: "이건 본문이다" })];
  const res = mockRes();
  await handler(req(events), res);
  check("(c) 본문류 필드 포함 → 400", res.code === 400, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(c) index=0 포함", res.body?.index === 0, JSON.stringify(res.body));
  check("(c) DB 호출 없음", upsertCalls === 0, `calls=${upsertCalls}`);
}

// (d) 51건 → 400
{
  upsertCalls = 0;
  const events = Array.from({ length: 51 }, (_, i) => validEvent({ clientEventId: uuidN(i + 100) }));
  const res = mockRes();
  await handler(req(events), res);
  check("(d) 51건 → 400", res.code === 400, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(d) DB 호출 없음", upsertCalls === 0, `calls=${upsertCalls}`);
}

// (e) 잘못된 event 값 → 400
{
  upsertCalls = 0;
  const events = [validEvent({ clientEventId: uuidN(6), event: "practice_maybe" })];
  const res = mockRes();
  await handler(req(events), res);
  check("(e) 잘못된 event → 400", res.code === 400, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(e) DB 호출 없음", upsertCalls === 0, `calls=${upsertCalls}`);
}

// (f) X-App-Token 없음 → 401, DB 호출 없음
{
  upsertCalls = 0;
  const events = [validEvent({ clientEventId: uuidN(7) })];
  const res = mockRes();
  await handler({ method: "POST", headers: {}, body: { events } }, res);
  check("(f) X-App-Token 없음 → 401", res.code === 401, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(f) DB 호출 없음", upsertCalls === 0, `calls=${upsertCalls}`);
}

// (g) 기기 시계가 미래로 틀어진 이벤트는 받은 시각으로 바로잡고, 과거 이벤트는 그대로 둔다
{
  upsertCalls = 0;
  const future = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const events = [validEvent({ clientEventId: uuidN(8), occurredAt: future }), validEvent({ clientEventId: uuidN(9), occurredAt: past })];
  nextUpsertRows = events.map((e) => ({ client_event_id: e.clientEventId }));
  const res = mockRes();
  await handler(req(events), res);
  const rows = Array.isArray(lastBody) ? lastBody : [];
  const f = rows.find((r) => r.client_event_id === uuidN(8));
  const p = rows.find((r) => r.client_event_id === uuidN(9));
  check("(g) 미래 시각은 지금 이하로 보정", f && Date.parse(f.occurred_at) <= Date.now() + 1000, JSON.stringify(f));
  check("(g) 과거 시각은 그대로", p && p.occurred_at === past, JSON.stringify(p));
}

// (h) 이탈 이벤트 + 소요시간
{
  upsertCalls = 0;
  bodies = [];
  const events = [validEvent({ clientEventId: uuidN(10), event: "practice_abandoned", elapsedMs: 42000 })];
  nextUpsertRows = [{ id: 10 }];
  const res = mockRes();
  await handler(req(events), res);
  check("(h) practice_abandoned → 200", res.code === 200, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(h) elapsed_ms가 그대로 실린다", bodies[0]?.[0]?.elapsed_ms === 42000, JSON.stringify(bodies[0]));
}

// (i) elapsedMs 검증
{
  for (const [label, value] of [["음수", -1], ["실수", 1500.5], ["24시간 초과", 24 * 60 * 60 * 1000 + 1]]) {
    upsertCalls = 0;
    const res = mockRes();
    await handler(req([validEvent({ clientEventId: uuidN(11), elapsedMs: value })]), res);
    check(`(i) elapsedMs ${label} → 400`, res.code === 400, `code=${res.code} body=${JSON.stringify(res.body)}`);
    check(`(i) elapsedMs ${label} — DB 호출 없음`, upsertCalls === 0, `calls=${upsertCalls}`);
  }
  // 없어도(구 버전 앱) 통과한다
  upsertCalls = 0;
  nextUpsertRows = [{ id: 11 }];
  const res = mockRes();
  await handler(req([validEvent({ clientEventId: uuidN(12) })]), res);
  check("(i) elapsedMs 없음 → 200", res.code === 200, `code=${res.code}`);
}

// (j) elapsed_ms 컬럼 마이그레이션 전 — 그 필드만 빼고 재시도
{
  upsertCalls = 0;
  bodies = [];
  nextErrors = [{ code: "42703", message: `column "elapsed_ms" of relation "practice_events" does not exist` }];
  nextUpsertRows = [{ id: 12 }];
  const res = mockRes();
  await handler(req([validEvent({ clientEventId: uuidN(13), elapsedMs: 1000 })]), res);
  check("(j) 컬럼 부재여도 200", res.code === 200, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check("(j) 두 번째 시도에는 elapsed_ms가 없다", upsertCalls === 2 && !("elapsed_ms" in bodies[1][0]), JSON.stringify(bodies[1]));
}

// (k) event CHECK 마이그레이션 전 — practice_abandoned만 빼고 재시도
{
  upsertCalls = 0;
  bodies = [];
  nextErrors = [
    { code: "23514", message: 'new row for relation "practice_events" violates check constraint "practice_events_event_check"' },
  ];
  nextUpsertRows = [{ id: 13 }];
  const events = [
    validEvent({ clientEventId: uuidN(14), event: "practice_completed" }),
    validEvent({ clientEventId: uuidN(15), event: "practice_abandoned" }),
  ];
  const res = mockRes();
  await handler(req(events), res);
  check("(k) CHECK 위반이어도 나머지는 저장된다(200)", res.code === 200, `code=${res.code} body=${JSON.stringify(res.body)}`);
  check(
    "(k) 두 번째 시도에는 practice_abandoned가 없다",
    upsertCalls === 2 && bodies[1].length === 1 && bodies[1][0].event === "practice_completed",
    JSON.stringify(bodies[1])
  );
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
