// 관리자 통계 — mau_tracking을 서버 내부(서비스 키)에서 집계해 반환.
// 서비스 키가 Sensitive라 외부에서 못 읽으므로, 키가 있는 서버 안에서 계산한다.
// 게이트: X-App-Token (집계 수치만 반환, PII·device_id 미노출).
import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken } from "./_usage.js";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

function normPlatform(p) {
  const s = (p || "").toLowerCase();
  if (s.includes("android")) return "Android";
  if (s.includes("ios") || s === "") return "iOS";
  return "other";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!checkAppToken(req)) return rejectAppToken(res);
  if (!supabase) return res.status(500).json({ error: "not configured" });

  try {
    // 전량 페이지네이션 (REST 1000행 상한 회피)
    let rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("mau_tracking")
        .select("device_id, platform, month")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
    }

    // 신규 유입: device별 최초 month
    const first = {};
    for (const r of rows) {
      if (!r.month) continue;
      if (!first[r.device_id] || r.month < first[r.device_id].month) {
        first[r.device_id] = { month: r.month, platform: normPlatform(r.platform) };
      }
    }
    const newByMonth = {};
    for (const d in first) {
      const { month, platform } = first[d];
      newByMonth[month] = newByMonth[month] || { iOS: 0, Android: 0, other: 0 };
      newByMonth[month][platform]++;
    }
    // 월 활성(MAU)
    const activeByMonth = {};
    for (const r of rows) {
      if (!r.month) continue;
      const p = normPlatform(r.platform);
      activeByMonth[r.month] = activeByMonth[r.month] || { iOS: 0, Android: 0, other: 0 };
      activeByMonth[r.month][p]++;
    }

    const totals = { iOS: 0, Android: 0, other: 0 };
    for (const d in first) totals[first[d].platform]++;

    return res.status(200).json({
      totalDevices: Object.keys(first).length,
      totalsByPlatform: totals,
      newByMonth,
      activeByMonth,
      rowsScanned: rows.length,
    });
  } catch (e) {
    console.error("[admin-stats]", e.message);
    return res.status(500).json({ error: "stats failed" });
  }
}
