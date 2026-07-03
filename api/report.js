import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const report = req.body;
  console.log("[REPORT]", JSON.stringify(report));

  // Supabase에 저장
  try {
    await supabase.from("reports").insert({
      type: report.type || "unknown",
      payload: report,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[REPORT DB ERROR]", e.message);
  }

  return res.status(200).json({ success: true, message: "Report received" });
}
