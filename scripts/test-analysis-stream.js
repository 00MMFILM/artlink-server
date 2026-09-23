// No API keys, paid model requests or live database: SDK stream + fetch are mocked.
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.APP_SECRET = "";
let mode, guest, charged, models;
const text = "📌 This is a sufficiently long synthetic practice analysis.\nSecond line.";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/auth/v1/user")) return guest ? json({}, 401) : json({ id: "test-user", aud: "authenticated" });
  if (u.pathname.endsWith("/premium_members")) return json([{ kind: "sub" }]);
  if (u.pathname.endsWith("/ai_usage_daily") || u.pathname.endsWith("/guest_ai_usage")) {
    if (init.method === "POST") {
      if (mode === "charge-failure") return json({ message: "simulated write error" }, 503);
      charged++;
      return json([]);
    }
    return json([]);
  }
  throw new Error(`Unexpected request blocked: ${u.pathname}`);
};
Anthropic.Messages.prototype.stream = function (params) {
  models.push(params.model);
  if (mode === "all-fail" || (mode === "fallback" && models.length === 1)) throw new Error("simulated provider failure");
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "content_block_delta", delta: { type: "text_delta", text } };
      if (mode === "midstream-failure") throw new Error("simulated stream disconnect");
    },
    async finalMessage() {
      if (mode === "final-failure") throw new Error("simulated missing final message");
      return { model: params.model, stop_reason: mode === "truncated" ? "max_tokens" : mode === "refusal" ? "refusal" : mode === "paused" ? "pause_turn" : "end_turn", usage: {} };
    },
  };
};
const { default: analyze } = await import("../api/ai-analyze.js");
async function run(nextMode, { legacy = false, isGuest = false } = {}) {
  mode = nextMode; guest = isGuest; charged = 0; models = [];
  const res = {
    chunks: [], headers: {}, headersSent: false,
    setHeader(k, v) { assert.equal(this.headersSent, false); this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    write(s) { this.headersSent = true; this.chunks.push(s); },
    end() { this.ended = true; return this; },
  };
  await analyze({ method: "POST", query: legacy ? { stream: "1" } : { stream: "1", protocol: "events" }, headers: { authorization: "Bearer test-token", "x-device-id": "test-guest" }, body: { prompt: "오늘 합성 연기 연습 기록", field: "acting" } }, res);
  assert.equal(res.ended, true);
  return { res, events: legacy ? [] : res.chunks.join("").trim().split("\n").filter(Boolean).map(JSON.parse) };
}
let { res, events } = await run("success");
assert.equal(res.headers["Content-Type"], "application/x-ndjson; charset=utf-8");
assert.deepEqual(events.map((e) => e.type), ["delta", "done"]);
assert.equal(events[0].text, text);
assert.equal(events.at(-1).model, "claude-opus-5");
assert.ok(events.at(-1).promptVersion);
assert.equal(charged, 1);
console.log("PASS completed event stream preserves newline text and records metadata after usage write");

({ events, res } = await run("fallback"));
assert.deepEqual(models, ["claude-opus-5", "claude-sonnet-5"]);
assert.equal(events.at(-1).model, "claude-sonnet-5");
assert.equal(res.headers["X-AL-Model"], "claude-sonnet-5");
assert.equal(charged, 1);
console.log("PASS pre-output fallback records the actual model");

for (const failure of ["all-fail", "midstream-failure", "final-failure", "truncated", "refusal", "paused", "charge-failure"]) {
  ({ events } = await run(failure));
  assert.equal(events.at(-1).type, "error");
  assert.ok(events.every((e) => e.type !== "done"));
  assert.equal(charged, 0);
  if (failure !== "all-fail") assert.equal(models.length, 1, "must not splice a second answer after output");
  console.log(`PASS ${failure}: no done marker or successful charge`);
}
({ events } = await run("charge-failure", { isGuest: true }));
assert.equal(events.at(-1).type, "error");
assert.ok(events.every((e) => e.type !== "done"));
console.log("PASS guest usage write failure cannot signal completion");

({ res } = await run("fallback", { legacy: true }));
assert.equal(res.chunks.join(""), text);
assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
assert.equal(res.headers["X-AL-Model"], "claude-sonnet-5");
console.log("PASS legacy request keeps plain text and actual fallback model header");
