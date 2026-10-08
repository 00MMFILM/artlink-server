// Synthetic records only; all SDK requests are intercepted in-process.
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "http://127.0.0.1:9/mock";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.APP_SECRET = "";
const rows = [
  { user_id: "private", name: "Private", email: "test@example.invalid", height: 177, weight: 65, height_private: true, weight_private: true },
  { user_id: "public", name: "Public", email: "test@example.invalid", height: 177, weight: 65, height_private: false, weight_private: false },
  // 게스트(users.auth_user_id 없음): 본인이 공개를 켠 사람만 보인다
  { user_id: "guest-opted-in", name: "안지민", notes_count: 2, photos: ["p.jpg"], profile_public: true, visibility_updated_at: "2026-09-29T09:21:44Z", height_private: false, weight_private: false },
  { user_id: "guest-untouched", name: "Guest", notes_count: 2, photos: ["p.jpg"], profile_public: true, visibility_updated_at: null, height_private: false, weight_private: false },
];
const GUESTS = new Set(["guest-opted-in", "guest-untouched"]);
let browseUrl;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  let data;
  if (u.pathname.endsWith("/users")) data = rows.filter((r) => !GUESTS.has(r.user_id)).map((r) => ({ id: r.user_id }));
  else if (u.pathname.endsWith("/artist_profiles")) {
    browseUrl = u;
    data = rows.filter((r) => u.searchParams.get("height_private") !== "eq.false" || !r.height_private);
  } else throw new Error(`Unexpected request blocked: ${u.pathname}`);
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
};
const { default: browse } = await import("../api/artist-browse.js");
const run = async (body) => {
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await browse({ method: "POST", headers: {}, body }, res);
  assert.equal(res.code, 200);
  return res.body.profiles;
};
const all = await run({});
assert.equal(all.find((r) => r.user_id === "private").height, null);
assert.equal(all.find((r) => r.user_id === "private").weight, null);
assert.equal(all.find((r) => r.user_id === "public").height, 177);
assert.ok(all.every((r) => !Object.hasOwn(r, "email")));
assert.ok(all.some((r) => r.user_id === "guest-opted-in"), "게스트라도 본인이 공개를 켰으면 보인다");
assert.ok(!all.some((r) => r.user_id === "guest-untouched"), "공개 스위치를 건드리지 않은 게스트는 숨긴다");
console.log("PASS private measurements masked, public measurements retained, contact data excluded, opted-in guest visible");
for (const filters of [{ heightMin: 170 }, { heightMax: 180 }, { heightMin: 170, heightMax: 180 }]) {
  const filtered = await run(filters);
  assert.equal(browseUrl.searchParams.get("height_private"), "eq.false");
  assert.deepEqual(filtered.map((r) => r.user_id).filter((id) => !GUESTS.has(id)), ["public"]);
}
console.log("PASS minimum, maximum and combined height filters exclude private values");
