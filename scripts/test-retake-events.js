// 1.11.9 재촬영 퍼널 이벤트 계약 — 실제 Supabase/외부 네트워크를 사용하지 않는다.
// 실행: node scripts/test-retake-events.js
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "offline-test-key";
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, "http://127.0.0.1:9");
  assert.equal(parsed.pathname, "/mock/rest/v1/funnel_events");
  assert.equal(init.method, "POST");
  calls.push({ url: parsed, init, body: JSON.parse(init.body) });
  return new Response(null, { status: 201 });
};
const { default: handler } = await import("../api/track-event.js");

function response() {
  return {
    code: null, body: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}
async function post(body) {
  const res = response();
  await handler({ method: "POST", body }, res);
  return res;
}
const events = ["retake_capture_added", "retake_analysis_done", "compare_viewed", "resume_card_tapped"];
let checked = 0;
for (const event of events) {
  const before = calls.length;
  const res = await post({ deviceId: "offline-device", event, language: "ko", platform: "ios", appVersion: "1.11.9" });
  assert.equal(res.code, 200, `${event} must be accepted`);
  assert.deepEqual(res.body, { success: true });
  assert.equal(calls.length, before + 1);
  const call = calls.at(-1);
  assert.deepEqual(call.body, {
    device_id: "offline-device", event, language: "ko", platform: "ios", app_version: "1.11.9",
  });
  assert.equal(call.url.searchParams.get("on_conflict"), "device_id,event");
  assert.match(new Headers(call.init.headers).get("prefer"), /resolution=ignore-duplicates/);
  console.log(`PASS ${event}: 200, metadata, first-device milestone contract`);
  checked++;
}
// 기존 퍼널과 동일하게 재전송해도 서버가 신규 반복 횟수로 저장하도록 바꾸지 않는다.
const retry = await post({ deviceId: "offline-device", event: "retake_analysis_done" });
assert.equal(retry.code, 200);
assert.match(new Headers(calls.at(-1).init.headers).get("prefer"), /resolution=ignore-duplicates/);
checked++;
for (const body of [undefined, {}, { deviceId: "offline-device" }, { deviceId: "offline-device", event: "retake_unknown" }]) {
  const before = calls.length;
  const res = await post(body);
  assert.equal(res.code, 400);
  assert.equal(calls.length, before, "invalid input must not write to storage");
  checked++;
}
const existing = await post({ deviceId: "offline-device", event: "repractice_started" });
assert.equal(existing.code, 200);
checked++;
for (const [method, code] of [["OPTIONS", 200], ["GET", 405]]) {
  const before = calls.length;
  const res = response();
  await handler({ method }, res);
  assert.equal(res.code, code);
  assert.equal(calls.length, before);
  checked++;
}
console.log(`ALL PASS: ${checked} offline cases`);
