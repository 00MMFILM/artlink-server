// 스레드 게시봇 로그 조회 — threads_post_log 최근 기록. X-App-Token 게이트.
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
    const { data, error } = await supabase
      .from("threads_post_log")
      .select("post_date, seq, kind, posted_id, text, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    const rows = (data || []).map((r) => ({
      date: r.post_date,
      seq: r.seq,
      kind: r.kind,
      posted: !!r.posted_id,
      hasTag: (r.text || "").includes("?s=threads"),
      hasLink: (r.text || "").includes("art-link.kr/app"),
      created_at: r.created_at,
    }));
    return res.status(200).json({ count: rows.length, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
