import { execFileSync } from "child_process";
import { readFileSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import os from "os";
import crypto from "crypto";
import ffmpegPath from "ffmpeg-static";
import { checkAppToken, rejectAppToken, identifyUser } from "./_usage.js";
import { hasDataConsent, copyTempToArchive, upsertMediaAsset, titleHash } from "./_archive.js";

export const config = { maxDuration: 120 };

// 원본 보존은 동의(X-Data-Consent: 1)한 경우에만 수행한다 — copyTempToArchive + media_assets.
// 앱은 전사 후 temp를 지우므로, 동의 시 여기서 복사해야 원본이 학습 자산으로 남는다.
// 구버전 앱은 이 헤더를 안 보내므로 자동으로 보관되지 않음 = 미동의 수집 즉시 중단.
// 보관 실패해도 전사 응답은 정상 반환 (보존은 부가 기능 — 단 로그는 남김).

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
    const { videoUrl, noteLocalId, field, noteTitle } = req.body || {};
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
    // SSRF 방어: 앱이 올린 Supabase Storage 원본만 허용 (ai-analyze/analyze-video와 동일 원칙).
    // 없으면 ffmpeg가 임의 내부주소(169.254.169.254 등)로 요청 가능.
    const storageBase = process.env.SUPABASE_URL;
    if (!storageBase || !videoUrl.startsWith(`${storageBase}/storage/`)) {
      return res.status(400).json({ error: "Only Supabase storage URLs allowed" });
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

    // 원본 보존 — 동의 시에만. 응답 전에 완료해야 함 (서버리스는 응답 후 프로세스가 얼어붙음)
    const user = await identifyUser(req);
    if (hasDataConsent(req)) {
      const archived = await copyTempToArchive(videoUrl, user?.id);
      if (archived) {
        const kind = /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(archived.storagePath) ? "video" : "audio";
        await upsertMediaAsset({
          user_id: user?.id || "anon",
          note_local_id: noteLocalId || null,
          field: field || null,
          title_hash: titleHash(noteTitle),
          kind,
          storage_path: archived.storagePath,
          consent_at: new Date().toISOString(),
        });
      }
    }

    return res.status(200).json({ transcript: transcript.trim() });
  } catch (error) {
    console.error("[transcribe] Error:", error.message);
    return res.status(500).json({ error: "Transcription failed" });
  } finally {
    try { unlinkSync(outputPath); } catch {}
  }
}
