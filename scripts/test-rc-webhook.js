// 오프라인 handler 회귀: sandbox 격리, TRANSFER 최신 상태/comp 보존/실패 재시도.
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.RC_WEBHOOK_AUTH = "test-webhook";
process.env.REVENUECAT_SECRET_KEY = "test-rc";
const rows = new Map();
const subscribers = new Map();
let writes = [];
let reads = [];
let rcStatus = 200;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.revenuecat.com") {
    const id = decodeURIComponent(u.pathname.split("/").pop());
    reads.push(id);
    return json({ subscriber: subscribers.get(id) }, rcStatus);
  }
  if (u.hostname !== "127.0.0.1" || !u.pathname.endsWith("/premium_members")) throw new Error("Unexpected network blocked");
  const method = init.method || "GET";
  const id = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
  if (method === "GET") return json(rows.get(id) || null);
  const patch = JSON.parse(init.body);
  writes.push({ method, patch, filter: u.search });
  if (method === "POST") rows.set(patch.user_id, { ...rows.get(patch.user_id), ...patch });
  if (method === "PATCH") {
    const row = rows.get(id);
    if (row && (!u.searchParams.has("kind") || u.searchParams.get("kind") === `eq.${row.kind}`)) rows.set(id, { ...row, ...patch });
  }
  return json([]);
};
const { default: handler } = await import("../api/rc-webhook.js");
const future = "2099-01-01T00:00:00Z";
const active = (sandbox = false) => ({
  entitlements: { premium: { product_identifier: "artlink_premium_monthly", expires_date: future } },
  subscriptions: { artlink_premium_monthly: { is_sandbox: sandbox, expires_date: future } },
});
async function call(event) {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: "POST", headers: { authorization: "test-webhook" }, body: { event } }, res);
  return res;
}
function reset() { rows.clear(); subscribers.clear(); writes = []; reads = []; rcStatus = 200; }
let failed = 0;
async function test(name, run) {
  reset();
  try { await run(); console.log("PASS", name); } catch (e) { failed++; console.error("FAIL", name, e.message); }
}
await test("sandbox expiration cannot disable production subscription", async () => {
  rows.set("payer", { kind: "sub", active: true });
  const res = await call({ type: "EXPIRATION", app_user_id: "payer", environment: "SANDBOX" });
  assert.equal(res.code, 200); assert.equal(rows.get("payer").active, true); assert.equal(writes.length, 0);
});
await test("sandbox purchase cannot become production paid row", async () => {
  const res = await call({ type: "INITIAL_PURCHASE", app_user_id: "tester", environment: "SANDBOX" });
  assert.equal(res.code, 200); assert.equal(writes.length, 0);
});
await test("production purchase keeps existing comp-to-sub promotion policy", async () => {
  rows.set("payer", { kind: "comp", active: true });
  subscribers.set("payer", active());
  await call({ type: "INITIAL_PURCHASE", app_user_id: "payer", environment: "PRODUCTION", product_id: "artlink_premium_monthly" });
  assert.equal(rows.get("payer").kind, "sub"); assert.equal(rows.get("payer").active, true);
});
await test("late expiration after renewal keeps current paid entitlement", async () => {
  rows.set("payer", { kind: "sub", active: true }); subscribers.set("payer", active());
  await call({ type: "RENEWAL", app_user_id: "payer", environment: "PRODUCTION", event_timestamp_ms: 200 });
  const res = await call({ type: "EXPIRATION", app_user_id: "payer", environment: "PRODUCTION", event_timestamp_ms: 100 });
  assert.equal(res.code, 200); assert.equal(rows.get("payer").active, true); assert.deepEqual(reads, ["payer", "payer"]);
});
await test("late purchase after expiration cannot revive expired subscription", async () => {
  rows.set("payer", { kind: "sub", active: true }); subscribers.set("payer", { entitlements: {} });
  await call({ type: "EXPIRATION", app_user_id: "payer", environment: "PRODUCTION", event_timestamp_ms: 200 });
  const res = await call({ type: "INITIAL_PURCHASE", app_user_id: "payer", environment: "PRODUCTION", event_timestamp_ms: 100 });
  assert.equal(res.code, 200); assert.equal(rows.get("payer").active, false);
});
await test("old expiration preserves manually assigned comp without a current purchase", async () => {
  rows.set("coach", { kind: "comp", active: true }); subscribers.set("coach", { entitlements: {} });
  const res = await call({ type: "EXPIRATION", app_user_id: "coach", environment: "PRODUCTION" });
  assert.equal(res.code, 200); assert.equal(rows.get("coach").active, true); assert.equal(rows.get("coach").kind, "comp");
});
await test("production API failure preserves access and returns 5xx for retry", async () => {
  rows.set("payer", { kind: "sub", active: true }); rcStatus = 503;
  const res = await call({ type: "EXPIRATION", app_user_id: "payer", environment: "PRODUCTION" });
  assert.ok(res.code >= 500); assert.equal(writes.length, 0); assert.equal(rows.get("payer").active, true);
});
await test("production missing key returns 503 without changing paid access", async () => {
  rows.set("payer", { kind: "sub", active: true });
  const original = process.env.REVENUECAT_SECRET_KEY; delete process.env.REVENUECAT_SECRET_KEY;
  try {
    const res = await call({ type: "EXPIRATION", app_user_id: "payer", environment: "PRODUCTION" });
    assert.equal(res.code, 503); assert.equal(writes.length, 0); assert.equal(reads.length, 0);
  } finally { process.env.REVENUECAT_SECRET_KEY = original; }
});
await test("TRANSFER without app_user_id reconciles both sides and deduplicates IDs", async () => {
  rows.set("old", { kind: "sub", active: true });
  subscribers.set("old", { entitlements: {} }); subscribers.set("new", active());
  const res = await call({ type: "TRANSFER", transferred_from: ["old", "$RCAnonymousID:a"], transferred_to: ["new", "new"] });
  assert.equal(res.code, 200); assert.deepEqual([...reads].sort(), ["new", "old"]);
  assert.equal(rows.get("old").active, false); assert.equal(rows.get("new").active, true);
});
await test("TRANSFER does not remove a different active production subscription", async () => {
  rows.set("old", { kind: "sub", active: true }); subscribers.set("old", active()); subscribers.set("new", active());
  await call({ type: "TRANSFER", transferred_from: ["old"], transferred_to: ["new"] });
  assert.equal(rows.get("old").active, true); assert.equal(rows.get("new").active, true);
});
await test("TRANSFER preserves manually assigned comp when subscriber has no purchase", async () => {
  rows.set("coach", { kind: "comp", active: true }); subscribers.set("coach", { entitlements: {} });
  await call({ type: "TRANSFER", transferred_from: ["coach"], transferred_to: [] });
  assert.equal(rows.get("coach").active, true); assert.deepEqual(reads, ["coach"]);
});
await test("TRANSFER API failure returns retryable status with no writes", async () => {
  rcStatus = 503;
  const res = await call({ type: "TRANSFER", transferred_from: ["old"], transferred_to: ["new"] });
  assert.ok(res.code >= 500); assert.equal(writes.length, 0);
});
await test("TRANSFER sandbox snapshot does not grant or revoke production access", async () => {
  rows.set("old", { kind: "sub", active: true });
  subscribers.set("old", active(true)); subscribers.set("new", active(true));
  const res = await call({ type: "TRANSFER", transferred_from: ["old"], transferred_to: ["new"] });
  assert.equal(res.code, 200); assert.equal(rows.get("old").active, true); assert.equal(rows.has("new"), false); assert.equal(writes.length, 0);
});
await test("TRANSFER malformed subscriber does not erase existing paid access", async () => {
  rows.set("old", { kind: "sub", active: true });
  subscribers.set("old", {});
  const res = await call({ type: "TRANSFER", transferred_from: ["old"], transferred_to: [] });
  assert.ok(res.code >= 500); assert.equal(rows.get("old").active, true); assert.equal(writes.length, 0);
});
await test("TRANSFER missing key must not silently acknowledge", async () => {
  const original = process.env.REVENUECAT_SECRET_KEY; delete process.env.REVENUECAT_SECRET_KEY;
  try {
    const res = await call({ type: "TRANSFER", transferred_from: ["old"], transferred_to: ["new"] });
    assert.equal(res.code, 503); assert.equal(writes.length, 0); assert.equal(reads.length, 0);
  } finally { process.env.REVENUECAT_SECRET_KEY = original; }
});
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exitCode = failed ? 1 : 0;
