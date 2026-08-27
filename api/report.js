import { createClient } from "@supabase/supabase-js";
import { checkAppToken, rejectAppToken } from "./_usage.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkAppToken(req)) return rejectAppToken(res);

  const report = req.body;
  console.log("[REPORT]", JSON.stringify(report));

  // Supabase에 저장
  try {
    // insert는 throw하지 않고 { error }를 돌려준다 → 확인 안 하면 신고가 통째로 유실됨
    const { error } = await supabase.from("reports").insert({
      type: report.type || "unknown",
      payload: report,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[REPORT DB ERROR]", error.message);
      return res.status(500).json({ success: false, message: "Report save failed" });
    }
  } catch (e) {
    console.error("[REPORT DB ERROR]", e.message);
    return res.status(500).json({ success: false, message: "Report save failed" });
  }

  return res.status(200).json({ success: true, message: "Report received" });
}
