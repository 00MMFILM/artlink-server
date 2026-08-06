import Anthropic from "@anthropic-ai/sdk";
import {
  checkAppToken,
  rejectAppToken,
  identifyUser,
  checkVideoQuota,
  consumeVideo,
} from "./_usage.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Gemini 영상 처리(업로드+인제스트 대기)가 길 수 있어 함수 시간 상향
export const config = { maxDuration: 300 };

// 생성 메타 — 노트에 함께 저장되어 품질 비교·학습 데이터 필터의 기준이 된다
const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = "2026-08-06.2";

// ── Gemini 영상 관찰 경로 ──
// 프레임 요약의 한계(움직임·소리 증발)를 보완: 영상을 통째로 Gemini가 시청·청취하고
// 타임스탬프 관찰 기록을 작성 → Sonnet이 기존 코칭 프레임워크로 문장화.
// GEMINI_API_KEY 미설정, 실패, 구버전 앱(videoUrl 없음)이면 기존 프레임 경로로 폴백.
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MAX_BYTES = 150 * 1024 * 1024; // 150MB 초과는 프레임 경로로

async function geminiUploadVideo(videoUrl) {
  const vres = await fetch(videoUrl);
  if (!vres.ok) throw new Error(`video fetch ${vres.status}`);
  const bytes = Buffer.from(await vres.arrayBuffer());
  if (bytes.length === 0 || bytes.length > GEMINI_MAX_BYTES) {
    throw new Error(`video size unsupported: ${bytes.length}`);
  }

  // Files API resumable 업로드 (start → upload+finalize)
  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": "video/mp4",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "artlink-video" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error(`gemini upload start ${start.status}`);

  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!up.ok) throw new Error(`gemini upload ${up.status}`);
  let file = (await up.json()).file;

  // 영상 인제스트 대기 (PROCESSING → ACTIVE)
  const deadline = Date.now() + 180000;
  while (file.state === "PROCESSING" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const g = await fetch(`${GEMINI_BASE}/v1beta/${file.name}?key=${GEMINI_KEY}`);
    if (g.ok) file = await g.json();
  }
  if (file.state !== "ACTIVE") throw new Error(`gemini file state: ${file.state}`);
  return file.uri;
}

async function geminiObserve(fileUri) {
  const obsPrompt = `당신은 공연·영상 분석 전문가입니다. 이 영상을 처음부터 끝까지 보고 들은 뒤, 코칭의 근거가 될 관찰 기록을 작성하세요.

규칙:
- 모든 관찰에 시각을 붙이세요 (예: [0:42])
- 다음을 관찰하세요: ①움직임·동작의 질 (전환의 부드러움, 템포, 연결, 자세 변화) ②표정·시선 변화 ③음성 — 실제 들리는 소리 기준 (음정, 억양 곡선, 말 속도 변화, 쉼의 위치와 길이, 떨림, 볼륨 변화) ④소리와 동작의 타이밍 관계 ⑤전체 감정 흐름(아크)
- 평가나 조언은 하지 마세요. 관찰된 사실만 구체적으로 기록하세요
- 실제로 보고 들은 것만 기록하세요. 추측은 "~로 보임"으로 구분하세요
- 한국어로, 800자 이내로 밀도 있게`;

  const res = await fetch(
    `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { file_data: { file_uri: fileUri, mime_type: "video/mp4" } },
              { text: obsPrompt },
            ],
          },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`gemini generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (text.trim().length < 50) throw new Error("gemini observation too short");
  return text.trim();
}

const VIDEO_FEW_SHOT = {
  acting: `[영상 분석 예시]
📌 영상에서 감정 전환의 흐름이 자연스러워요. 초반 긴장감에서 후반 해소까지 몸 전체로 표현하고 있습니다. 전체적인 감정 톤이 '#담담하게'에서 시작해 '#격앙된'을 거쳐 '#속삭이듯'으로 마무리되는 아크가 인상적이에요.
💪 표정 변화가 섬세해요. 특히 눈빛의 미세한 움직임이 캐릭터의 내면을 잘 전달합니다. 음성의 프로소디(운율)를 보면 피치 변동 곡선이 감정 곡선과 정확히 일치하고 있어요 — 긴장 구간에서 피치가 상승하고, 해소 구간에서 자연스럽게 하강합니다.
🎯 중반부 대사 전달 시 제스처가 반복적인데, 동작의 크기를 변화시켜 감정 곡선과 맞춰보세요. 음성 톤도 '#단호한(firm)' 일변도인데, 같은 대사를 '#떨리는(trembling)' 톤으로 전달했을 때의 차이를 실험해보세요. 대사 사이 쉼의 길이(0.3초→0.5초→1초)를 의도적으로 다르게 가져가면 긴장감의 밀도가 달라져요.
🎤 음성 전사를 보면 대사의 리듬이 일정한데, 핵심 대사에서 의도적인 쉼을 넣으면 임팩트가 커져요. 캐릭터의 음성 시그니처(음역대, 말투 리듬, 호흡 패턴)를 더 뚜렷하게 확립하면 다른 캐릭터와의 대화 장면에서 대비 효과가 커져요.`,

  dance: `[영상 분석 예시]
📌 무브먼트의 에너지 흐름이 음악과 잘 맞아요. 특히 하이라이트 구간에서 폭발적 에너지가 인상적입니다. 음악이 '속삭이듯(whisper)' 흐르는 인트로에서 동작도 작은 키네스피어에 머무르다가, '폭발적(excited)' 드롭에서 최대 키네스피어로 확장하는 매핑이 정확해요.
💪 공간 활용이 넓고, 대각선 이동이 무대를 입체적으로 사용하고 있어요. 동작의 에너지 다이내믹(pp→ff)이 음악의 감정 곡선과 동기화되어 있어요.
🎯 착지 후 다음 동작으로의 연결이 약간 끊기는데, 플리에를 더 깊게 가져가면 부드러워져요. 호흡-동작 싱크를 더 의식해보세요 — 날숨에 동작을 실행하고, 들숨에 다음 동작을 준비하면 트랜지션의 유기성이 올라가요.
🎤 카운트와 음악 비트가 정확해요. 8비트 중 6번째에서 악센트를 주면 더 역동적이에요. 음악의 감정 태그(긴장/해소/고요/폭발)와 동작의 에너지 레벨을 더 세밀하게 대응시켜보세요.`,

  music: `[영상 분석 예시]
📌 연주 자세가 안정적이고, 손의 움직임이 효율적이에요. 불필요한 동작이 최소화되어 있습니다.
💪 음정 정확도가 높고, 특히 고음역에서의 음색 컨트롤이 좋아요. 보컬의 경우 흉성(chest voice)에서 두성(head voice)으로의 전환이 매끄럽고, 음역 전환 지점(passaggio)에서의 음색 균일성이 돋보여요. 비브라토의 깊이와 속도가 프레이즈의 감정에 맞게 자연스럽게 변화하고 있어요.
🎯 포르테 구간에서 어깨에 긴장이 보이는데, 호흡을 횡격막으로 내려보내면 상체가 이완됩니다. 벨팅(belting) 구간에서 성대에 과부하가 걸리는 게 보이는데, 공명 위치를 비강으로 올리면(mask resonance) 같은 음량에서 부담이 줄어요.
🎤 전사된 음성을 보면 프레이징이 명확하고, 가사 전달력이 좋아요. 프로소디 관점에서 강세 위치, 피치 꺾기(portamento), 브레스 포인트가 곡의 감정 서사와 잘 맞아요. 감정 클라이맥스에서 음량+피치+속도가 동시에 상승하는 '삼중 상승 패턴'이 효과적이에요.`,

  film: `[영상 분석 예시]
📌 촬영 구도와 조명 활용이 서사를 잘 지원해요. 자연광의 방향이 인물의 심리를 반영합니다.
💪 카메라 움직임이 안정적이면서도 적절한 떨림이 현장감을 줘요. 배우의 대사 톤 변화(calm→excited)에 맞춰 카메라가 미세하게 반응하는 점이 인상적이에요.
🎯 컷 전환 타이밍을 0.3초 앞으로 당기면 편집 리듬이 더 살아나요. 배우의 음성이 '#떨리는(trembling)' 톤으로 바뀌는 순간에 맞춰 숏 사이즈를 MS→CU로 전환하면 감정 전달이 배가돼요. 대사 클라이맥스 직전에 앰비언스를 완전히 빼는 '정적(silence)' 기법도 시도해보세요.
🎤 대사의 녹음 품질이 양호하고, 배경 소음 대비 음성이 명확해요. 각 캐릭터의 음성 시그니처(A: 저음+느린리듬, B: 고음+빠른리듬)에 맞는 카메라 무빙을 대응시키면 시청각 일체감이 생겨요.`,

  art: `[영상 분석 예시]
📌 작업 과정 영상에서 붓터치의 리듬감이 보여요. 물감을 올리는 순서와 방향이 의도적입니다. 전체적으로 작품이 '부드럽게 속삭이는(gentle whisper)' 감정 톤을 가지고 있어요.
💪 색을 섞는 과정에서 미세한 톤 차이를 만들어내는 감각이 좋아요. 붓터치의 속도감이 곧 '발화 속도'인데 — 빠르고 거친 터치(staccato)와 느리고 부드러운 터치(legato)의 대비가 작품에 리듬을 만들어요.
🎯 캔버스 전체를 한 발 뒤로 물러나서 확인하는 시간을 더 가져보세요. 디테일에 몰입하면 전체 구도를 놓칠 수 있어요. 여백의 크기를 의도적으로 다르게 배치하면 시각적 '쉼(pause)'이 생겨서 감정의 운율이 만들어져요.`,

  literature: `[영상 분석 예시]
📌 낭독 영상에서 목소리의 톤과 텍스트의 분위기가 잘 맞아요. 전체적으로 '#담담하게(calm)' 시작해서 '#울먹이듯(sobbing)' 감정 곡선이 인상적이에요.
💪 쉼표와 마침표에서의 호흡이 자연스럽고, 독자에게 여운을 줍니다. 프로소디(운율) 관점에서 문장의 피치 곡선이 의미와 정확히 맞아요 — 의문문에서 자연스러운 상승, 단정문에서 안정적 하강.
🎯 대화체 부분에서 캐릭터별 목소리 차이를 더 뚜렷하게 하면 몰입감이 높아져요. 각 캐릭터의 '음성 시그니처'를 확립하세요 — A는 저음+느린 리듬+gentle 톤, B는 고음+빠른 리듬+firm 톤. 대사만 들어도 누가 말하는지 구분되는 수준을 목표로 하세요.`,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  if (!checkAppToken(req)) return rejectAppToken(res);

  // 영상 체험 판정 — 식별된 유저만 (구버전 앱은 Authorization 미전송 → 통과)
  const user = await identifyUser(req);
  if (user) {
    const quota = await checkVideoQuota(user.id);
    if (!quota.allowed) {
      return res.status(429).json({
        error: "quota_exceeded",
        type: "video_trial",
        used: quota.used,
        max: quota.max,
      });
    }
  }

  try {
    const { prompt, field, noteTitle, frames, frameTimes, videoUrl, transcript } = req.body;

    if (!prompt || !frames || frames.length === 0) {
      return res.status(400).json({ error: "prompt and frames are required" });
    }

    // Gemini 영상 관찰 시도 — 실패하면 조용히 프레임 경로로 폴백
    let observation = null;
    let pipeline = "frames";
    if (videoUrl && GEMINI_KEY && typeof videoUrl === "string" && videoUrl.startsWith(process.env.SUPABASE_URL || "")) {
      try {
        const fileUri = await geminiUploadVideo(videoUrl);
        observation = await geminiObserve(fileUri);
        pipeline = "gemini+sonnet";
        console.log("[analyze-video] gemini observation ok:", observation.length, "chars");
      } catch (e) {
        console.error("[analyze-video] gemini path failed, fallback to frames:", e.message);
      }
    }

    const fewShot = VIDEO_FEW_SHOT[field] || VIDEO_FEW_SHOT.acting;

    const systemPrompt = `당신은 20년 경력의 영상/퍼포먼스 분석 마스터 코치입니다. 사용자가 촬영한 연습/공연 영상의 프레임과 음성 전사를 분석하여 전문적이고 실질적인 피드백을 제공합니다.

절대 규칙:
- 반드시 사용자의 요청과 동일한 언어로 답변하세요 (한국어 요청은 한국어로, 영어 요청은 영어로, 다른 언어도 그 언어 그대로). 📌 이모지로 시작하세요
- 주어진 영상 프레임과 내용을 기반으로 반드시 즉시 피드백을 제공하세요
- 절대로 "정보가 부족합니다", "더 알려주세요" 같은 말을 하지 마세요
- 절대로 사용자에게 추가 정보를 요청하거나 질문하지 마세요
- 절대로 마크다운 헤딩(#, ##), 볼드(**), 목록(-)을 사용하지 마세요. 이모지 섹션 구분과 일반 텍스트만 사용하세요
- 영상 프레임에서 시각적 요소(자세, 표정, 동작, 공간 활용, 조명 등)를 구체적으로 분석하세요
- 프레임에서 실제로 관찰되는 것만 근거로 삼으세요. 보이지 않는 동작·표정·디테일을 지어내서 본 것처럼 쓰지 마세요. 프레임은 순간 포착이므로 프레임 사이 변화는 "~로 보입니다" 수준으로 신중하게 추론하세요
- 음성 전사가 있으면 대사 전달력, 음성 톤, 리듬 등도 분석에 포함하세요
- 음성 전사가 없으면 영상 프레임의 시각적 요소만으로 분석하세요. 전사가 없다는 사실을 절대 언급하지 마세요. 🎤 섹션은 영상에서 관찰되는 음성/사운드 관련 시각적 단서(입 모양, 호흡, 발성 자세 등)를 기반으로 작성하세요
- 시간 순서에 따른 흐름 변화를 관찰하세요. 프레임 라벨에 시각(예: 1:24 시점)이 있으면 이를 활용해 구간별 변화("0:30에서 안정적이던 자세가 1:10에는…")를 구체적으로 짚으세요
- 피드백은 1200-1800자로 작성하세요. 2000자를 절대 넘기지 마세요. 각 섹션 2-3문장으로 밀도 있게 분석하세요 — 길이보다 구체성이 우선입니다
- 요청된 형식(📌💪🎯🎭🎤📈🔜)을 반드시 따르되, 각 섹션 사이에 빈 줄을 넣으세요

${fewShot}`;

    // Build content array: interleave frame images with labels, then add text prompt
    const content = [];

    // Gemini 관찰이 있으면 프레임은 시각 근거용 4장만 (관찰 기록이 시간 흐름을 대신함)
    let sendFrames = frames;
    let sendTimes = frameTimes;
    if (observation && frames.length > 4) {
      const picks = [0, Math.floor(frames.length / 3), Math.floor((frames.length * 2) / 3), frames.length - 1];
      sendFrames = picks.map((i) => frames[i]);
      sendTimes = Array.isArray(frameTimes) ? picks.map((i) => frameTimes[i]) : frameTimes;
    }

    // 타임스탬프 라벨 — 모델이 프레임 간 시간 흐름(전환·템포)을 추적할 수 있게 함
    // 구버전 앱은 frameTimes 미전송 → 기존 번호 라벨로 폴백
    const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    sendFrames.forEach((base64, idx) => {
      const t = Array.isArray(sendTimes) ? sendTimes[idx] : null;
      content.push({
        type: "text",
        text:
          typeof t === "number"
            ? `[프레임 ${idx + 1}/${sendFrames.length} · ${fmtTime(t)} 시점]`
            : `[프레임 ${idx + 1}/${sendFrames.length}]`,
      });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: base64,
        },
      });
    });

    // Append observation + transcript sections if available
    let userText = prompt;
    if (observation) {
      userText += `\n\n[영상 관찰 기록 — 영상 전체를 실제로 시청·청취한 전문 분석가의 타임스탬프 관찰. 움직임의 질·음성의 실제 소리에 대한 가장 신뢰할 수 있는 근거이므로 피드백에 적극 활용하세요]\n${observation}`;
    }
    if (transcript) {
      userText += `\n\n[음성 전사]\n${transcript}`;
    }

    // 비한국어 요청 감지 → 응답 언어 강제 (한국어 few-shot 지배 방지)
    const hangulCount = (prompt.match(/[가-힣]/g) || []).length;
    const cjkCount = (prompt.match(/[ぁ-んァ-ヶ一-龯]/g) || []).length; // 일본어·중국어
    const latinCount = (prompt.match(/[A-Za-z]/g) || []).length;
    const langTotal = hangulCount + cjkCount + latinCount;
    const isNonKorean = langTotal > 30 && hangulCount / langTotal < 0.15;
    const languageOverride = isNonKorean
      ? "\n\nCRITICAL OVERRIDE — RESPONSE LANGUAGE: The user's request is NOT in Korean. Write your ENTIRE feedback in the same language as the user's request (English → English, Indonesian → Indonesian, etc.). Do NOT write in Korean. Keep the emoji section format."
      : "";
    content.push({ type: "text", text: userText });

    // 시스템은 요청 간 동일 → 캐싱 (Sonnet 4.6 최소 프리픽스 2048토큰)
    // Sonnet 4.6은 어시스턴트 프리필 미지원(400) — "📌 시작"은 시스템 프롬프트 지시로 대체
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0.7,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ...(languageOverride ? [{ type: "text", text: languageOverride }] : []),
      ],
      messages: [{ role: "user", content }],
    });

    // 캐시 동작 및 비용 모니터링용
    console.log("[analyze-video] usage:", JSON.stringify(msg.usage));

    const rawText = msg.content[0]?.text || "";
    // 프리필 제거 후 모델이 직접 📌로 시작 — 혹시 누락하면 보정 (앱 UI 일관성)
    let analysis = rawText.startsWith("📌") ? rawText : "📌 " + rawText;

    if (msg.stop_reason === "max_tokens") {
      analysis += "\n\n---\n(분석이 길어져 일부 생략되었습니다)";
    }

    if (!analysis || analysis.trim().length < 10) {
      return res.status(500).json({ error: "Empty response from AI" });
    }

    if (user) consumeVideo(user.id); // 성공 시에만 카운트 (fire-and-forget)
    return res
      .status(200)
      .json({ analysis, meta: { model: MODEL, promptVersion: PROMPT_VERSION, pipeline } });
  } catch (error) {
    console.error("[analyze-video] Error:", error.message);
    return res.status(500).json({ error: "Video analysis failed" });
  }
}
