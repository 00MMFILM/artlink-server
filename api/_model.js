// 요금제별 분석 모델 (2026-09-17 대표 결정)
// 프리미엄(구독·무료지정) = Opus 5, 무료·게스트 = Sonnet 5.
// 배경: 그전엔 전원 claude-sonnet-4-6라 "최상위 AI 모델" 안내가 사실과 달랐고, 결제해도 분석이 똑같았다.
// Opus 5·Sonnet 5는 temperature/top_p/top_k를 보내면 400, thinking은 기본 adaptive이고
// thinking 토큰도 max_tokens에 포함된다 → max_tokens를 넉넉히 주고 effort로 비용을 조절한다.
export const MODEL_PREMIUM = "claude-opus-5";
export const MODEL_FREE = "claude-sonnet-5";

export function modelParams(isPremium) {
  return {
    model: isPremium ? MODEL_PREMIUM : MODEL_FREE,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: isPremium ? "medium" : "low" },
  };
}

// 프리미엄 호출이 실패(모델 한도·일시 오류)하거나 거절(stop_reason "refusal")이면 무료 모델로 한 번 더 시도한다.
export function paramChain(isPremium) {
  return isPremium ? [modelParams(true), modelParams(false)] : [modelParams(false)];
}

// thinking 블록이 content[0]에 올 수 있으므로 text 블록만 모은다.
export function textOf(msg) {
  return (msg?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

export function isRefusal(msg) {
  return msg?.stop_reason === "refusal";
}
