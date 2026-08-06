import { execFileSync } from "child_process";
import { readFileSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import os from "os";
import crypto from "crypto";
import ffmpegPath from "ffmpeg-static";
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";

export const config = { maxDuration: 120 };

// 원본 보존: 앱이 temp-media(공개·임시)에 올린 원본을 private 버킷 media-archive로 복사.
// 앱은 전사 후 temp를 지우므로, 여기서 복사해야 영상·음성 원본이 학습 자산으로 남는다.
// 실패해도 전사 응답은 정상 반환 (보존은 부가 기능 — 단 로그는 남김).
async function archiveOriginal(videoUrl, userId) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key || !videoUrl.startsWith(base)) return;
  const marker = "/temp-media/";
  const i = videoUrl.indexOf(marker);
  if (i === -1) return;
  const sourceKey = decodeURIComponent(videoUrl.slice(i + marker.length));
  const destinationKey = `${userId || "anon"}/${sourceKey}`;
  try {
    const r = await fetch(`${base}/storage/v1/object/copy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        bucketId: "temp-media",
        sourceKey,
        destinationBucket: "media-archive",
        destinationKey,
      }),
    });
    if (!r.ok) console.error("[transcribe] archive failed:", r.status, await r.text());
  } catch (e) {
    console.error("[transcribe] archive error:", e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  if (!checkAppToken(req)) return rejectAppToken(res);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });

  const tmpDir = os.tmpdir();
  const uniqueId = crypto.randomUUID();
  const outputPath = join(tmpDir, `output_${uniqueId}.mp3`);

  try {
    const { videoUrl } = req.body || {};
    if (!videoUrl)
      return res.status(400).json({ error: "videoUrl required" });

    // Validate URL to prevent command injection
    let parsed;
    try {
      parsed = new URL(videoUrl);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Only http/https URLs allowed" });
    }

    try {
      chmodSync(ffmpegPath, 0o755);
    } catch {}

    // Use execFileSync with args array to prevent shell injection
    execFileSync(ffmpegPath, [
      "-i", videoUrl,
      "-vn", "-acodec", "libmp3lame", "-q:a", "8", "-y", outputPath
    ], { timeout: 90000, stdio: "pipe" });

    const audioBuffer = readFileSync(outputPath);

    // Send audio to Whisper API
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioBuffer], { type: "audio/mpeg" }),
      "audio.mp3"
    );
    formData.append("model", "whisper-1");
    // 언어: 쿼리로 지정 가능(?lang=ko 등). 미지정 시 Whisper 자동 감지 — 외국어 음성 지원
    const langParam = (req.query && req.query.lang) || "";
    if (langParam && langParam !== "auto") formData.append("language", langParam);
    formData.append("response_format", "text");

    const whisperRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      }
    );

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("[transcribe] Whisper error:", errText);
      return res.status(502).json({ error: "Transcription failed" });
    }

    const transcript = await whisperRes.text();

    // 원본 보존 — 응답 전에 완료해야 함 (서버리스는 응답 후 프로세스가 얼어붙음)
    const user = await identifyUser(req);
    await archiveOriginal(videoUrl, user?.id);

    return res.status(200).json({ transcript: transcript.trim() });
  } catch (error) {
    console.error("[transcribe] Error:", error.message);
    return res.status(500).json({ error: "Transcription failed" });
  } finally {
    try { unlinkSync(outputPath); } catch {}
  }
}
