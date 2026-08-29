// 종합점수 + 연습 마일리지·레벨 서버 일괄 재계산·백필 (2026-08-29)
// - 점수: 앱 analyticsService.computeArtistProfile과 동일한 공식.
// - 마일리지: api/_mileage.js와 동일한 공식(누적·무상한·감소불가) — 별도 로직, 임의 변경 금지.
// - 서버는 로컬 미디어(사진·음성)를 못 보므로 깊이는 보수적으로 계산됨 → 실제보다 낮거나 같다.
// - 안전장치: 점수·마일리지 모두 "오르는 경우에만" 반영(하락 0 보장), 원본 백업, JSONL 실행로그.
// - mileage/level 컬럼이 아직 없으면(schema-mileage.sql 미실행) 해당 필드만 빼고 재시도.
// 사용: node scripts/backfill-scores.js --dry   (미리보기)
//       node scripts/backfill-scores.js --apply (실제 반영)
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ENV = path.join(__dirname, "..", ".env.local");
const LOG_DIR = path.join(process.env.HOME, ".artlink-meta");
const LOG = path.join(LOG_DIR, "score-backfill.jsonl");

function envFrom(p, k) {
  try {
    const l = fs.readFileSync(p, "utf8").split("\n").find((x) => x.startsWith(k + "="));
    return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch { return null; }
}
const URL = envFrom(ENV, "SUPABASE_URL");
const KEY = envFrom(ENV, "SUPABASE_SERVICE_KEY") || envFrom(ENV, "SUPABASE_SERVICE_ROLE_KEY");
if (!URL || !KEY) { console.error("SUPABASE_URL/SERVICE_KEY를 .env.local에서 찾을 수 없음"); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// 앱 공식과 1:1 대응
function computeScore(notes) {
  const fieldCounts = {}, tagCounts = {};
  let totalContentLength = 0, mediaRecordCount = 0;
  notes.forEach((n) => {
    const f = n.field || "etc";
    fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    (n.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    totalContentLength += (n.content || "").length + (n.transcript || "").length;
    mediaRecordCount += n.video_analysis ? 1 : 0; // 서버 가시 범위
  });
  const aiCount = notes.filter((n) => n.ai_comment).length;
  const noteScore = Math.min(100, notes.length * 5);
  const aiScore = Math.min(100, aiCount * 10);
  const primaryFieldCount = Object.values(fieldCounts).reduce((m, v) => Math.max(m, v), 0);
  const specializationScore = Math.min(100, Math.max(
    Object.keys(fieldCounts).length * 20,
    Object.keys(tagCounts).length * 8,
    primaryFieldCount * 8,
  ));
  const depthScore = Math.min(100, Math.round(totalContentLength / 100) + mediaRecordCount * 5);
  const dates = [...new Set(notes.map((n) => new Date(n.created_at).toDateString()))];
  const consistencyScore = notes.length < 2 ? 0 : Math.min(100, dates.length * 8);
  return Math.round((noteScore + aiScore + specializationScore + depthScore + consistencyScore) / 5);
}

// api/_mileage.js와 1:1 대응(고정 공식 — 임의 변경 금지)
function thresholdForLevel(L) { return 25 * L * (L + 1); }
function levelForMileage(xp) {
  const mileage = Number.isFinite(xp) && xp > 0 ? xp : 0;
  if (mileage <= 0) return 1;
  let L = Math.floor((-1 + Math.sqrt(1 + (4 * mileage) / 25)) / 2);
  if (L < 1) L = 1;
  while (thresholdForLevel(L + 1) <= mileage) L++;
  while (L > 1 && thresholdForLevel(L) > mileage) L--;
  return L;
}
function computeMileage(notes) {
  let totalContentLength = 0, aiCount = 0, mediaCount = 0;
  const dateSet = new Set();
  notes.forEach((n) => {
    totalContentLength += (n.content || "").length + (n.transcript || "").length;
    if (n.ai_comment) aiCount++;
    if (n.video_analysis) mediaCount++;
    dateSet.add(new Date(n.created_at).toDateString());
  });
  return notes.length * 10 + aiCount * 15 + dateSet.size * 20 + mediaCount * 15 + Math.floor(totalContentLength / 100);
}

async function get(pathQ) {
  const r = await fetch(`${URL}/rest/v1/${pathQ}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${pathQ} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

(async () => {
  // mileage/level 컬럼이 아직 없으면(schema-mileage.sql 미실행) 점수만 있는 select로 폴백
  let hasMileageCols = true;
  let profiles;
  try {
    profiles = await get("artist_profiles?select=user_id,name,score,mileage,level&limit=500");
  } catch (e) {
    console.error(`mileage/level 컬럼 없음 — schema-mileage.sql 미실행으로 추정, 점수만 백필: ${e.message}`);
    hasMileageCols = false;
    profiles = await get("artist_profiles?select=user_id,name,score&limit=500");
  }
  const users = await get("users?select=id,auth_user_id&limit=5000");
  const authBy = new Map(users.map((u) => [u.id, u.auth_user_id]));
  const notes = await get("user_notes?select=auth_user_id,field,tags,content,transcript,ai_comment,video_analysis,created_at&deleted=eq.false&limit=20000");
  const byAuth = new Map();
  notes.forEach((n) => {
    if (!byAuth.has(n.auth_user_id)) byAuth.set(n.auth_user_id, []);
    byAuth.get(n.auth_user_id).push(n);
  });

  const plan = [];
  profiles.forEach((p) => {
    const ns = byAuth.get(authBy.get(p.user_id));
    if (!ns || !ns.length) return;
    const next = computeScore(ns);
    const cur = p.score || 0;
    const entry = { user_id: p.user_id, name: p.name, from: cur, to: next, willUpdate: next > cur };
    if (hasMileageCols) {
      const nextMileage = computeMileage(ns);
      const curMileage = p.mileage || 0;
      entry.mileageFrom = curMileage;
      entry.mileageTo = Math.max(curMileage, nextMileage); // 감소 불가 — 상향만
      entry.mileageWillUpdate = entry.mileageTo > curMileage;
      entry.levelTo = levelForMileage(entry.mileageTo);
    }
    plan.push(entry);
  });

  const ups = plan.filter((x) => x.willUpdate || x.mileageWillUpdate);
  console.log(`대상 프로필 ${plan.length}명 / 상향 반영 ${ups.length}명 / 변화 없음 ${plan.length - ups.length}명`);
  ups.sort((a, b) => (b.to - b.from) - (a.to - a.from))
    .forEach((x) => {
      const scorePart = x.willUpdate ? `점수 ${x.from} → ${x.to} (+${x.to - x.from})` : `점수 변화없음(${x.from})`;
      const mileagePart = hasMileageCols
        ? (x.mileageWillUpdate ? `, 마일리지 ${x.mileageFrom} → ${x.mileageTo}(Lv${x.levelTo})` : `, 마일리지 변화없음(${x.mileageFrom})`)
        : "";
      console.log(`  ${x.name}: ${scorePart}${mileagePart}`);
    });
  if (!hasMileageCols) console.log("(mileage/level 컬럼 없음 — schema-mileage.sql 실행 후 재실행하면 마일리지도 백필됨)");

  if (!APPLY) { console.log("\n[미리보기] 실제 반영하려면 --apply"); return; }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString();
  // 롤백용 원본 스냅샷
  const backup = path.join(LOG_DIR, `score-backup-${stamp.slice(0, 19).replace(/[:T]/g, "")}.json`);
  fs.writeFileSync(backup, JSON.stringify(plan, null, 2));
  console.log(`\n원본 백업: ${backup}`);

  let ok = 0, fail = 0;
  for (const x of ups) {
    const body = { score: x.to };
    if (hasMileageCols) { body.mileage = x.mileageTo; body.level = x.levelTo; }
    const r = await fetch(`${URL}/rest/v1/artist_profiles?user_id=eq.${encodeURIComponent(x.user_id)}`, {
      method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    const line = {
      ts: new Date().toISOString(), action: "score_backfill", user_id: x.user_id, name: x.name,
      from: x.from, to: x.to,
      ...(hasMileageCols ? { mileageFrom: x.mileageFrom, mileageTo: x.mileageTo, levelTo: x.levelTo } : {}),
      status: r.ok ? "ok" : `http_${r.status}`,
    };
    if (r.ok) ok++; else { fail++; line.error = (await r.text()).slice(0, 200); }
    fs.appendFileSync(LOG, JSON.stringify(line) + "\n");
  }
  fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), action: "score_backfill_summary", updated: ok, failed: fail, backup }) + "\n");
  console.log(`반영 완료: 성공 ${ok}명 / 실패 ${fail}명`);
  console.log(`실행로그: ${LOG}`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
