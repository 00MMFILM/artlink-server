// 스마트링크 클릭 통계 — link_clicks 집계. X-App-Token 게이트.
import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken } from "./_usage.js";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!checkAppToken(req)) return rejectAppToken(res);
  if (!supabase) return res.status(500).json({ error: "not configured" });

  try {
    let rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("link_clicks")
        .select("source, platform, created_at")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
    }

    const bySource = {};
    const byPlatform = {};
    const byDay = {};
    for (const r of rows) {
      bySource[r.source || "direct"] = (bySource[r.source || "direct"] || 0) + 1;
      byPlatform[r.platform || "?"] = (byPlatform[r.platform || "?"] || 0) + 1;
      const day = (r.created_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }
    // 최근 14일만
    const recentDays = Object.fromEntries(
      Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
    );

    return res.status(200).json({
      totalClicks: rows.length,
      bySource,
      byPlatform,
      byDay: recentDays,
    });
  } catch (e) {
    console.error("[link-stats]", e.message);
    return res.status(500).json({ error: "stats failed" });
  }
}
