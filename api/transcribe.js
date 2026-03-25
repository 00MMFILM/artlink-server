import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import os from "os";
import ffmpegPath from "ffmpeg-static";

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });

  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const inputPath = join(tmpDir, `input_${ts}.mp4`);
  const outputPath = join(tmpDir, `output_${ts}.mp3`);

  try {
    // 1. Get video buffer from URL
    const { videoUrl } = req.body || {};
    if (!videoUrl)
      return res.status(400).json({ error: "videoUrl required" });

    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok)
      return res.status(502).json({ error: "Failed to download video" });

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    writeFileSync(inputPath, videoBuffer);

    // 2. Extract audio with ffmpeg (removes video track, MP3 output ~3MB for 5min)
    try {
      chmodSync(ffmpegPath, 0o755);
    } catch {}

    execSync(
      `${ffmpegPath} -i "${inputPath}" -vn -acodec libmp3lame -q:a 8 -y "${outputPath}"`,
      { timeout: 60000, stdio: "pipe" }
    );

    const audioBuffer = readFileSync(outputPath);

    // 3. Send audio to Whisper API
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioBuffer], { type: "audio/mpeg" }),
      "audio.mp3"
    );
    formData.append("model", "whisper-1");
    formData.append("language", "ko");
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
    return res.status(200).json({ transcript: transcript.trim() });
  } catch (error) {
    console.error("[transcribe] Error:", error.message);
    return res.status(500).json({ error: "Transcription failed" });
  } finally {
    // Clean up temp files
    try { unlinkSync(inputPath); } catch {}
    try { unlinkSync(outputPath); } catch {}
  }
}
