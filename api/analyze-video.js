import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VIDEO_FEW_SHOT = {
  acting: `[영상 분석 예시]
📌 영상에서 감정 전환의 흐름이 자연스러워요. 초반 긴장감에서 후반 해소까지 몸 전체로 표현하고 있습니다.
💪 표정 변화가 섬세해요. 특히 눈빛의 미세한 움직임이 캐릭터의 내면을 잘 전달합니다.
🎯 중반부 대사 전달 시 제스처가 반복적인데, 동작의 크기를 변화시켜 감정 곡선과 맞춰보세요.
🎤 음성 전사를 보면 대사의 리듬이 일정한데, 핵심 대사에서 의도적인 쉼을 넣으면 임팩트가 커져요.`,

  dance: `[영상 분석 예시]
📌 무브먼트의 에너지 흐름이 음악과 잘 맞아요. 특히 하이라이트 구간에서 폭발적 에너지가 인상적입니다.
💪 공간 활용이 넓고, 대각선 이동이 무대를 입체적으로 사용하고 있어요.
🎯 착지 후 다음 동작으로의 연결이 약간 끊기는데, 플리에를 더 깊게 가져가면 부드러워져요.
🎤 카운트와 음악 비트가 정확해요. 8비트 중 6번째에서 악센트를 주면 더 역동적이에요.`,

  music: `[영상 분석 예시]
📌 연주 자세가 안정적이고, 손의 움직임이 효율적이에요. 불필요한 동작이 최소화되어 있습니다.
💪 음정 정확도가 높고, 특히 고음역에서의 음색 컨트롤이 좋아요.
🎯 포르테 구간에서 어깨에 긴장이 보이는데, 호흡을 횡격막으로 내려보내면 상체가 이완됩니다.
🎤 전사된 음성을 보면 프레이징이 명확하고, 가사 전달력이 좋아요.`,

  film: `[영상 분석 예시]
📌 촬영 구도와 조명 활용이 서사를 잘 지원해요. 자연광의 방향이 인물의 심리를 반영합니다.
💪 카메라 움직임이 안정적이면서도 적절한 떨림이 현장감을 줘요.
🎯 컷 전환 타이밍을 0.3초 앞으로 당기면 편집 리듬이 더 살아나요.
🎤 대사의 녹음 품질이 양호하고, 배경 소음 대비 음성이 명확해요.`,

  art: `[영상 분석 예시]
📌 작업 과정 영상에서 붓터치의 리듬감이 보여요. 물감을 올리는 순서와 방향이 의도적입니다.
💪 색을 섞는 과정에서 미세한 톤 차이를 만들어내는 감각이 좋아요.
🎯 캔버스 전체를 한 발 뒤로 물러나서 확인하는 시간을 더 가져보세요. 디테일에 몰입하면 전체 구도를 놓칠 수 있어요.`,

  literature: `[영상 분석 예시]
📌 낭독 영상에서 목소리의 톤과 텍스트의 분위기가 잘 맞아요.
💪 쉼표와 마침표에서의 호흡이 자연스럽고, 독자에게 여운을 줍니다.
🎯 대화체 부분에서 캐릭터별 목소리 차이를 더 뚜렷하게 하면 몰입감이 높아져요.`,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const { prompt, field, noteTitle, frames, transcript } = req.body;

    if (!prompt || !frames || frames.length === 0) {
      return res.status(400).json({ error: "prompt and frames are required" });
    }

    const fewShot = VIDEO_FEW_SHOT[field] || VIDEO_FEW_SHOT.acting;

    const systemPrompt = `당신은 ArtLink의 영상 분석 전문 AI 코치입니다. 사용자가 촬영한 연습/공연 영상의 프레임과 음성 전사를 분석하여 전문적이고 따뜻한 피드백을 제공합니다.

규칙:
- 한국어로 답변하세요
- 영상 프레임에서 시각적 요소(자세, 표정, 동작, 공간 활용, 조명 등)를 구체적으로 분석하세요
- 음성 전사가 있으면 대사 전달력, 음성 톤, 리듬 등도 분석에 포함하세요
- 시간 순서에 따른 흐름 변화를 관찰하세요
- 구체적 근거를 들어 피드백하세요

${fewShot}`;

    // Build content array: interleave frame images with labels, then add text prompt
    const content = [];

    frames.forEach((base64, idx) => {
      content.push({
        type: "text",
        text: `[프레임 ${idx + 1}/${frames.length}]`,
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

    // Append transcript section if available
    let userText = prompt;
    if (transcript) {
      userText += `\n\n[음성 전사]\n${transcript}`;
    }
    content.push({ type: "text", text: userText });

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    });

    const analysis = msg.content[0]?.text;

    if (!analysis) {
      return res.status(500).json({ error: "Empty response from AI" });
    }

    return res.status(200).json({ analysis });
  } catch (error) {
    console.error("[analyze-video] Error:", error.message);
    return res.status(500).json({ error: "Video analysis failed" });
  }
}
