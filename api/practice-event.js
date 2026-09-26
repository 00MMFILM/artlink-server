// 반복 연습 이벤트 수집 (2단계, 2026-09-13). 설계안: 스크래치패드
// stage2-practice-events-plan.md §3·§5·§6. 목적은 "7일 안 재연습" 측정뿐 —
// 대본·노트 본문·녹음·영상은 절대 받지 않는다(본문류 필드가 오면 400으로 되돌려
// 앱의 실수를 조기에 잡는다).
//
// 인증: X-App-Token 필수(checkAppToken, 기존 track-event 등과 동일).
// Authorization: Bearer <supabase jwt>는 선택 — 있으면 identifyUser로 auth_user_id를
// 채우고, 없거나 무효면 null(게스트)로 저장한다(비로그인 다수가 정상 케이스).
//
// 계약: POST /api/practice-event { events: [...] } (1~50건)
//  → 200 { accepted, duplicates } | 400 { error, index, reason } | 401 | 500
//
// 저장: practice_events.UNIQUE(device_id, client_event_id) + upsert(ignoreDuplicates:true)
// — supabase-js는 onConflict/ignoreDuplicates를 upsert()에서만 지원한다(insert()엔 없음).
// resolution=ignore-duplicates는 충돌 행을 DO NOTHING 하므로 upsert를 써도 기존 행을
// 덮어쓰지 않는다 — 동작은 "중복 무시 insert" 그대로다. .select("id")로 실제 삽입된
// (중복 아닌) 행만 돌려받아 accepted/duplicates를 요청 건수와의 차이로 계산한다.
import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const MAX_EVENTS = 50;

const EVENT_WHITELIST = new Set(["practice_started", "practice_completed", "ai_feedback_done", "practice_abandoned"]);
const KIND_WHITELIST = new Set(["text", "video", "checkin", "duet", "reanalysis"]);
const PLATFORM_WHITELIST = new Set(["ios", "android"]);

// 앱이 이대로 보내기로 한 필드만 허용. 여기 없는 키(title/content/text/transcript/audio 등
// 본문류 포함)가 하나라도 있으면 통째로 400 — 조용히 무시하지 않는다.
const ALLOWED_KEYS = new Set([
  "clientEventId",
  "sessionId",
  "event",
  "kind",
  "subjectKey",
  "field",
  "occurredAt",
  "deviceId",
  "language",
  "platform",
  "appVersion",
  "elapsedMs", // 1.11.8 — 세션 시작부터 완료·이탈까지 걸린 시간
]);

const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNullableString(v, maxLen) {
  if (v === null || v === undefined) return true;
  return typeof v === "string" && v.length <= maxLen;
}

// 이벤트 한 건을 검증. 통과하면 null, 실패하면 사유 문자열.
function validateEvent(ev) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return "event must be an object";

  for (const key of Object.keys(ev)) {
    if (!ALLOWED_KEYS.has(key)) return `unexpected field: ${key}`;
  }

  if (typeof ev.clientEventId !== "string" || !UUID_RE.test(ev.clientEventId)) {
    return "clientEventId must be a uuid";
  }
  if (typeof ev.sessionId !== "string" || !UUID_RE.test(ev.sessionId)) {
    return "sessionId must be a uuid";
  }
  if (typeof ev.event !== "string" || !EVENT_WHITELIST.has(ev.event)) {
    return "event must be one of " + [...EVENT_WHITELIST].join("|");
  }
  if (typeof ev.kind !== "string" || !KIND_WHITELIST.has(ev.kind)) {
    return "kind must be one of " + [...KIND_WHITELIST].join("|");
  }
  // ACT RAW IDs can be 62 characters before the "actraw:" namespace. The DB
  // column is TEXT; this also accepts every previous <=64-character client ID.
  if (!isNullableString(ev.subjectKey, 96)) return "subjectKey must be a string(<=96) or null";
  if (!isNullableString(ev.field, 32)) return "field must be a string(<=32) or null";
  if (typeof ev.occurredAt !== "string" || Number.isNaN(Date.parse(ev.occurredAt))) {
    return "occurredAt must be a parseable ISO8601 timestamp";
  }
  if (typeof ev.deviceId !== "string" || ev.deviceId.length === 0 || ev.deviceId.length > 128) {
    return "deviceId must be a string(1-128)";
  }
  if (!isNullableString(ev.language, 16)) return "language must be a string(<=16) or null";
  if (typeof ev.platform !== "string" || !PLATFORM_WHITELIST.has(ev.platform)) {
    return "platform must be one of " + [...PLATFORM_WHITELIST].join("|");
  }
  if (typeof ev.appVersion !== "string" || ev.appVersion.length === 0 || ev.appVersion.length > 32) {
    return "appVersion must be a string(1-32)";
  }
  if (ev.elapsedMs !== undefined && ev.elapsedMs !== null) {
    if (!Number.isInteger(ev.elapsedMs) || ev.elapsedMs < 0 || ev.elapsedMs > MAX_ELAPSED_MS) {
      return `elapsedMs must be an integer between 0 and ${MAX_ELAPSED_MS}`;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!checkAppToken(req)) return rejectAppToken(res);
  if (!supabase) return res.status(500).json({ error: "not configured" });

  const events = req.body && req.body.events;
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "events must be a non-empty array" });
  }
  if (events.length > MAX_EVENTS) {
    return res.status(400).json({ error: `events must be at most ${MAX_EVENTS}` });
  }

  for (let i = 0; i < events.length; i++) {
    const reason = validateEvent(events[i]);
    if (reason) return res.status(400).json({ error: "invalid event", index: i, reason });
  }

  // Authorization이 있으면 식별 시도 — 실패해도(만료 등) 게스트로 계속 진행한다.
  const user = await identifyUser(req);

  // 기기 시계가 미래로 틀어진 경우(9/19 판정 때 10월 날짜가 섞였다) 받은 시각으로 바로잡는다.
  // 과거로 늦게 도착한 이벤트(오프라인 큐)는 정상이므로 그대로 둔다.
  const now = Date.now();
  const clampTime = (iso) => (Date.parse(iso) > now + 10 * 60 * 1000 ? new Date(now).toISOString() : iso);
  const rows = events.map((ev) => ({
    device_id: ev.deviceId,
    auth_user_id: user ? user.id : null,
    event: ev.event,
    kind: ev.kind,
    session_id: ev.sessionId,
    client_event_id: ev.clientEventId,
    subject_key: ev.subjectKey ?? null,
    field: ev.field ?? null,
    occurred_at: clampTime(ev.occurredAt),
    app_version: ev.appVersion,
    platform: ev.platform,
    language: ev.language ?? null,
    elapsed_ms: ev.elapsedMs ?? null,
  }));

  // migrations/2026-09-26-practice-elapsed.sql(elapsed_ms 컬럼 + practice_abandoned CHECK)을
  // 아직 실행하지 않았어도 나머지 계측이 500으로 막히면 안 된다 — 스키마가 거부하면 새 항목을
  // 덜어내고 한 번 더 넣는다. 마이그레이션을 실행하면 첫 시도에서 바로 통과한다.
  const send = (list) =>
    supabase
      .from("practice_events")
      .upsert(list, { onConflict: "device_id,client_event_id", ignoreDuplicates: true })
      .select("id");
  const withoutElapsed = () => rows.map(({ elapsed_ms, ...rest }) => rest);

  try {
    let { data, error } = await send(rows);
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      ({ data, error } = await send(withoutElapsed()));
    }
    if (error && error.code === "23514") {
      const known = withoutElapsed().filter((r) => r.event !== "practice_abandoned");
      if (known.length === 0) return res.status(200).json({ accepted: 0, duplicates: rows.length });
      ({ data, error } = await send(known));
    }
    if (error) {
      console.error("[practice-event] upsert failed:", error.message);
      return res.status(500).json({ error: "db error" });
    }
    const accepted = data ? data.length : 0;
    return res.status(200).json({ accepted, duplicates: rows.length - accepted });
  } catch (e) {
    console.error("[practice-event]", e.message);
    return res.status(500).json({ error: "db error" });
  }
}
