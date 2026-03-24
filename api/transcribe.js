export const config = { runtime: "edge" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    let file;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // URL-based: download video from Supabase Storage URL
      const { videoUrl } = await req.json();
      if (!videoUrl) {
        return new Response(JSON.stringify({ error: "videoUrl required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to download video" }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const blob = await videoRes.blob();
      file = new File([blob], "video.mp4", { type: blob.type || "video/mp4" });
    } else {
      // Direct file upload (for small files under 4.5MB)
      const formData = await req.formData();
      file = formData.get("file");
    }

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Forward to Whisper API
    const whisperForm = new FormData();
    whisperForm.append("file", file, file.name || "video.mp4");
    whisperForm.append("model", "whisper-1");
    whisperForm.append("language", "ko");
    whisperForm.append("response_format", "text");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("[transcribe] Whisper error:", errText);
      return new Response(JSON.stringify({ error: "Transcription failed" }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const transcript = await whisperRes.text();

    return new Response(JSON.stringify({ transcript: transcript.trim() }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[transcribe] Error:", error.message);
    return new Response(JSON.stringify({ error: "Transcription failed" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
}
