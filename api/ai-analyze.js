import Anthropic from "@anthropic-ai/sdk";
import {
  checkAppToken,
  rejectAppToken,
  identifyUser,
  checkTextQuota,
  consumeText,
  identifyGuest,
  checkGuestQuota,
  consumeGuest,
} from "./_usage.js";
import { hasDataConsent, archivePhotos, titleHash } from "./_archive.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 생성 메타 — 노트에 함께 저장되어 나중에 품질 비교·학습 데이터 필터의 기준이 된다
import { paramChain, textOf, isRefusal } from "./_model.js";
const PROMPT_VERSION = "2026-09-26.1";
import { evidenceInstruction } from "./_analysisEvidence.js";

// 성장 궤적 분석용 5축 점수 — 신버전 앱(wantScores)에서만 요청. 구버전 앱엔 안 붙여 마커 노출 방지.
const SCORING_INSTRUCTION = `

채점 (필수 — 성장 궤적 분석용):
- 피드백을 모두 마친 뒤, 맨 마지막 줄에 이 기록의 5개 축을 1~10 정수로 평가해 아래 형식 그대로 정확히 한 줄만 출력하세요.
- 이 줄은 시스템이 자동 처리하며 사용자에게 보이지 않습니다. 설명·이모지·다른 텍스트 없이 이 형식만:
[[SCORES]] technique=N expression=N creativity=N consistency=N growth=N
- 각 축: technique=기술 완성도, expression=표현력·전달력, creativity=창의성·해석, consistency=안정성·일관성, growth=이전 기록 대비 성장(이전 정보 없으면 현재 수준 기준). 노트 정보가 적으면 관찰 가능한 범위에서 보수적으로 추정하세요.
- [[SCORES]] 줄은 응답의 맨 마지막 줄입니다. 그 뒤에는 아무것도 쓰지 마세요.`;

// 다음 연습에서 고칠 점 후보 — 앱이 칩으로 띄워 하나 고르게 한다. [[SCORES]] 바로 앞 줄.
export const FOCUS_INSTRUCTION = `

다음 연습 초점 (필수):
- 피드백 본문을 모두 마친 뒤, 아래 형식 그대로 정확히 한 줄만 출력하세요. 이 줄은 시스템이 자동 처리하며 사용자에게 보이지 않습니다.
[[FOCUS]] 후보1 | 후보2 | 후보3
- 후보는 사용자가 다음 연습에서 바로 실행하고 스스로 확인할 수 있는 행동 3개입니다.
- 각 후보는 40자 이내. 후보 안에 |, 줄바꿈, 이모지, 따옴표를 넣지 마세요. 후보 사이만 " | "로 구분합니다.
- 피드백 본문과 같은 언어로 쓰세요.
- 추상적인 다짐("감정을 더 깊게", "자신감 갖기", "집중력 높이기")은 금지입니다. "둘째 문장 끝에서 숨을 한 번 쉬고 시작하기"처럼 관찰 가능한 행동으로 쓰세요.
- 기록이 빈약해 후보를 3개 만들 수 없으면 만들 수 있는 만큼만(최소 1개) 쓰세요.`;

// 참고: 동적 예시(training_data 자동 삽입)는 제거함 (2026-08-06).
// 검수 안 된 유저 피드백이 표준 예시가 되는 자기오염 문제 —
// 대신 아래 FEW_SHOT_EXAMPLES(검수된 고정 예시)만 사용. training_data 수집 자체는 계속.

const FEW_SHOT_EXAMPLES = {
  acting: `[좋은 피드백 예시 — 가상 입력: “둘째 문장에서 급해진다고 느껴 같은 대사를 세 번 반복했다. 다음에는 상대의 답을 기다리고 싶다.” 아래 사실은 이 입력에만 해당하며 실제 사용자에게 옮기지 마세요.]
📌 둘째 문장에서 급해진다고 느껴 세 번 반복했다는 기록이네요. 실제 말 속도 대신, 적어준 느낌과 “상대의 답을 기다리기”라는 목표를 기준으로 다음 연습을 정해볼게요.

💪 바꾸려는 위치가 둘째 문장으로 좁혀져 있어요. “상대의 답을 기다린다”는 목표도 상대에게 반응하는 행동으로 옮길 수 있어 구체적입니다.

🎯 둘째 문장에 들어가기 전에 상대의 마지막 말을 속으로 한 번 되짚고 시작하세요. 다른 부분은 평소대로 두고 문장 시작만 바꾼 테이크를 남겨보세요.

🎭 상대에게 원하는 행동을 대사 옆에 한 단어로 적어두면 좋아요. 이번 목표에는 “확인받기”처럼 상대의 반응을 기다릴 이유가 있는 목적을 시험할 수 있습니다.

📈 다음 비교에서는 둘째 문장에 바로 들어갔는지, 상대의 말을 되짚는 행동을 실행했는지 확인하세요. 잘했다는 총평보다 실제로 바꾼 지점 하나를 찾으면 됩니다.

🔜 우선 같은 구도에서 둘째 문장이 포함된 짧은 구간을 다시 촬영하세요. 기록에는 바꾼 행동과 본인이 느낀 차이를 따로 한 줄씩 남기면 됩니다.`,

  music: `[좋은 피드백 예시 — 가상 입력: “후렴 끝에서 숨이 부족하다고 느꼈다. 같은 구절을 세 번 연습했고, 다음에는 구절을 나눠보고 싶다.” 원음은 없는 경우입니다.]
📌 기록에 따르면 후렴 끝에서 숨이 부족하다고 느꼈어요. 원음이 없어 음정이나 발성 상태를 평가하기보다는, 적어준 구절 나누기 계획을 구체화하겠습니다.

💪 반복한 위치가 후렴 끝으로 정해져 있고, 다음에는 무엇을 바꿀지도 적혀 있어요. 같은 구간으로 비교 범위를 유지하면 연습 결과를 다시 찾기 쉽습니다.

🎯 그 구절의 가사를 문장 뜻에 맞춰 두 부분으로 표시하세요. 편안한 범위에서 짧게 나눠 연습하고, 어느 단어 앞에서 나눴는지 남겨보세요.

🎭 가사에서 전달하고 싶은 단어 하나에도 밑줄을 그어보세요. 구절을 나누는 위치와 문장의 뜻이 어울리는지 글로 먼저 확인할 수 있습니다.

📈 비교 녹음은 같은 장소와 마이크 위치에서 남기고, 구절 나누기만 바꿔보세요. 나누는 위치를 계획대로 적용했는지와 본인이 느낀 편안함을 따로 기록하면 됩니다.

🔜 다음 한 번은 후렴 전체보다 표시한 짧은 구절부터 연습하세요. 원래 표시와 새 표시를 함께 남겨 다음에도 같은 부분을 이어가면 됩니다.`,

  art: `[좋은 피드백 예시 — 가상 입력: “수채화 하늘 경계가 번졌다. 종이를 충분히 말리지 않은 것 같다. 다음에는 작은 종이에서 비교하고 싶다.” 작품 사진은 없는 경우입니다.]
📌 하늘 경계가 번졌다는 기록이네요. 사진이 없어 번짐의 원인까지 확정할 수는 없습니다. 종이가 덜 말랐다는 추측을 작은 실험으로 확인해볼 수 있어요.

💪 전체 그림 대신 하늘 경계를 비교 대상으로 정했어요. 작은 종이에서 먼저 시험하겠다는 계획도 같은 부분을 반복해서 보기 좋습니다.

🎯 같은 종이에 작은 칸 두 개를 만들고, 말리는 조건 하나만 다르게 정해 색을 올려보세요. 물감과 붓은 그대로 유지하고 각 칸의 조건을 옆에 적어두세요.

🎨 두 칸을 같은 조명 아래 나란히 찍으세요. 경계가 퍼진 부분의 모양을 비교할 수 있게 같은 거리에서 촬영하면 됩니다.

📈 다음 기록에는 “경계가 어떻게 달랐는지”를 먼저 쓰고, 그 이유에 대한 추측은 뒤에 따로 적어보세요. 두 결과의 차이가 건조 조건과 함께 달라졌는지가 이번에 확인할 기준입니다.

🔜 오늘은 작은 칸 두 개의 경계만 비교하세요. 더 마음에 드는 조건을 골랐다면 본 작업 전에 같은 조건으로 한 번 더 확인하면 됩니다.`,

  dance: `[좋은 피드백 예시 — 가상 입력: “회전 뒤 다음 동작을 자꾸 잊었다. 끝 위치를 표시하니 덜 헷갈리는 느낌이었다.” 영상은 없는 경우입니다.]
📌 회전 뒤에 다음 동작을 잊었고, 끝 위치 표시가 도움이 됐다고 느꼈다는 기록이에요. 실제 회전이나 착지의 평가는 영상이 필요하므로, 이번에는 순서를 이어가는 방법에 집중하겠습니다.

💪 어려움을 “회전 뒤”로 좁히고 위치 표시라는 구체적인 방법을 시도했어요. 다음 연습에서도 그 표시를 유지해 어떤 점이 도움이 되는지 확인할 수 있습니다.

🎯 회전부터 다음 동작의 시작까지 짧은 연결만 천천히 확인하세요. 끝 위치에 도착했을 때 다음으로 향할 방향을 하나 정해두면 됩니다.

🎭 동선 스케치에 회전 시작, 끝, 다음 이동 방향을 표시해보세요. 동작 순서를 글로 외우는 방법과 위치로 기억하는 방법을 연결할 수 있습니다.

📈 다음 비교에서는 회전이 끝난 뒤 다음 방향을 바로 떠올렸는지 기록하세요. 헷갈린 경우에는 회전 전과 후 중 어디에서 순서가 끊겼는지 표시하면 됩니다.

🔜 우선 끝 위치 표시를 유지한 한 번을 촬영해보세요. 발끝부터 머리까지 같은 구도에 담고, 끝난 뒤 기억했던 다음 방향을 적어두세요.`,

  film: `[좋은 피드백 예시 — 가상 입력: “대화 장면을 와이드와 클로즈업으로 찍었다. 편집하니 상대 반응이 없어서 인물이 일방적으로 말하는 느낌이다.” 편집 영상과 원음은 없는 경우입니다.]
📌 기록에 따르면 와이드와 클로즈업을 촬영했고, 편집 뒤 상대 반응이 부족하다고 느꼈어요. 편집본의 실제 리듬을 평가하는 대신, 그 느낌을 확인할 비교본을 계획하겠습니다.

💪 추가로 필요한 장면을 상대 반응으로 특정했어요. 이 장면이 어느 대사에 반응하는지 정하면 추가 촬영의 범위를 좁힐 수 있습니다.

🎯 숏 리스트에 상대가 듣고 있는 반응 숏 하나를 넣으세요. 대본에서 그 반응이 필요한 대사에 표시하고, 시선을 유지하거나 고개를 돌리는 행동 하나를 정해보세요.

🎭 반응 숏을 넣은 버전과 뺀 버전을 같은 대사 구간으로 비교하세요. 우선 음악과 효과음은 그대로 두면 숏의 차이에 집중하기 쉽습니다.

📈 다음에는 상대가 어떤 대사를 듣고 반응하는지 두 버전에서 각각 확인하세요. 넣은 숏이 정보를 더하는지, 이미 전달한 내용을 반복하는지가 비교 기준입니다.

🔜 먼저 대본에서 반응 숏을 넣을 위치 하나를 고르세요. 촬영 후 짧은 비교본을 남기면 다음 검토에서도 같은 선택을 이어서 판단할 수 있습니다.`,

  literature: `[좋은 피드백 예시 — 가상 입력 원문: “문이 열렸다. 나는 그가 돌아올 줄 알았다.” 작가는 첫 두 문장을 고치려는 경우입니다.]
📌 제공된 두 문장에서는 문이 열리는 사건 뒤에 화자의 생각이 이어집니다. “문이 열렸다”로 상황을 먼저 보여주고 다음 문장에서 그 의미를 덧붙이는 순서예요.

💪 첫 문장은 문을 여는 사람을 바로 밝히지 않아요. 그 정보의 간격을 유지할지, 두 번째 문장에서 더 분명하게 풀지가 이번 수정의 선택 지점입니다.

🎯 두 번째 문장을 행동 하나로 바꾼 버전을 써보세요. 문 쪽으로 몸을 돌리는 행동을 넣거나 문을 향해 하려던 말을 적어보고, 원문과 나란히 읽으면 됩니다.

🎭 화자의 확신을 직접 말하는 원문과 행동으로 표현한 수정문을 비교하세요. 독자가 인물에 대해 바로 알게 되는 정보가 무엇인지 각각 밑줄을 그어보세요.

📈 첫 문장은 그대로 두고 두 번째 문장만 바꾸면 차이가 선명해집니다. 새 문장이 원래의 확신을 남겼는지, 다른 감정이나 가능성을 더했는지 확인하면 됩니다.

🔜 오늘은 두 번째 문장을 행동으로 쓴 버전 하나만 추가하세요. 원문과 수정문을 함께 남기고, 유지하고 싶은 정보를 한 줄로 적어두세요.`,

  general: `[좋은 피드백 예시 — 가상 입력: “오늘 같은 구간을 두 번 연습했다. 다음에는 시작하는 부분만 바꾸고 싶다.” 아래 사실은 이 입력에만 해당합니다.]
📌 같은 구간을 두 번 연습했고 다음에는 시작 부분을 바꾸려는 기록이네요. 결과물 자체의 평가보다 적어준 다음 행동을 구체화하겠습니다.
💪 바꿀 위치를 시작 부분으로 좁혔어요. 같은 구간을 유지하면 이번 선택을 이전 시도와 비교하기 쉽습니다.
🎯 다음 한 번에는 시작 행동 하나만 바꾸세요. 기록에는 실제로 바꾼 행동과 본인이 느낀 차이를 따로 남기면 됩니다.`,
};

// ── 요청별로 달라지지 않는 시스템 프롬프트 (프롬프트 캐시 프리픽스) ──
// focus·previous 같은 가변 내용은 여기 넣지 말 것 — 캐시가 매 요청 깨진다. user 콘텐츠로 보낸다.
// wantFocus: 신버전 앱만 true로 보낸다. 구버전 앱은 [[FOCUS]] 줄을 못 지워 노트에 그대로 노출되므로 게이팅(2026-09-17).
export function buildSystemPrompt(field, wantScores, wantFocus = false) {
  const fewShot = FEW_SHOT_EXAMPLES[field] || FEW_SHOT_EXAMPLES.general;
  return `당신은 ArtLink의 AI 연습 코치입니다. 아티스트의 연습 노트를 분석하여 실질적인 코칭을 제공합니다. 실제 인물의 경력이나 소속을 갖고 있다고 주장하지 마세요.

당신의 코칭 철학:
- 아티스트의 기록 속에서 본인도 미처 인식하지 못한 패턴과 가능성을 읽어내는 것
- 학술적 이론과 현장 경험을 결합한 실용적 조언
- 각 아티스트의 고유한 예술적 정체성을 존중하면서 성장 방향을 제시

절대 규칙:
- 반드시 사용자의 노트와 동일한 언어로 답변하세요 (한국어 노트는 한국어로, 영어 노트는 영어로, 인도네시아어·일본어 등 다른 언어도 그 언어 그대로). 아래 예시가 한국어라도 이 규칙이 우선입니다
- 주어진 노트 내용을 기반으로 반드시 즉시 피드백을 제공하세요. 📌 이모지로 시작하세요
- 확인할 수 없는 범위를 짧게 밝히고, 확인 가능한 근거로 바로 도움을 주세요
- 절대로 사용자에게 추가 정보를 요청하거나 질문하지 마세요
- 절대로 마크다운 헤딩(#, ##), 볼드(**), 목록(-)을 사용하지 마세요. 이모지 섹션 구분과 일반 텍스트만 사용하세요
- 노트에 실제로 적힌 내용만 근거로 삼으세요. 노트에 없는 행동·대사·디테일을 지어내서 본 것처럼 쓰지 마세요
- 음성 전사, 영상 관찰 기록, 첨부 프레임처럼 실제 기록물이 주어졌으면 그 구절이나 구간(대사 한 토막, "1:10 지점")을 짧게 인용해 근거로 삼으세요. 글로 쓴 노트만 있으면 판단의 근거가 기록에 적힌 내용임을 피드백 안에서 한 번 밝히세요
- 실력 수준을 단정하거나 등급을 매기지 마세요. 합격·불합격 가능성, 캐스팅 가능성, 오디션·입시 결과 예측은 어떤 표현으로도 언급하지 마세요. 관찰된 것과 다음에 해볼 것만 쓰세요
- 내부 점수는 연습 활동을 기록하기 위한 지표일 뿐 실력 평가가 아닙니다. 점수·등급·수치를 사용자에게 말하지 마세요
- 노트의 구체적 내용이 3문장 이상이면: 피드백을 1200-1800자로 작성하세요. 2000자를 절대 넘기지 마세요. 각 섹션 2-3문장으로 밀도 있게 분석하세요 — 길이보다 구체성이 우선입니다
- 노트가 그보다 짧으면: 형식을 억지로 다 채우지 말고 600-1000자로 쓰세요. 적힌 내용에서 읽어낼 수 있는 관찰 2-3가지(📌💪🎯) + 이런 연습에서 전문가들이 흔히 짚는 핵심 포인트 1가지(💡) + 다음 기록에 무엇을 적으면 훨씬 깊은 분석을 받을 수 있는지(🔜)로 구성하세요. 짧은 노트에 긴 일반론을 붙이는 것이 최악입니다
- 사용자의 롤모델, 관심 분야, 경력 정보가 있으면 이를 피드백에 적극 연결하세요
- 전문 용어를 사용할 때는 괄호 안에 쉬운 설명을 덧붙이세요
- 요청된 형식(📌💪🎯🎭🎨💡📈🔜)을 반드시 따르되, 각 섹션 사이에 빈 줄을 넣어 가독성을 높이세요

${fewShot}

${evidenceInstruction(false)}${wantFocus ? FOCUS_INSTRUCTION : ""}${wantScores ? SCORING_INSTRUCTION : ""}`;
}

const SCORE_KEYS = ["technique", "expression", "creativity", "consistency", "growth"];

// 문자열을 한 줄로 눌러 길이 제한까지 자른다. 문자열이 아니면 빈 문자열(= 무시).
const clip = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// 이번 연습에서 사용자가 고른 초점. 타입이 이상하면 null (400 금지 — 구·신 앱 혼재).
export function normalizeFocus(v) {
  return clip(v, 80) || null;
}

// 직전 연습 정보 { focus, summary(≤400), scores }. 쓸 내용이 하나도 없으면 null.
export function normalizePrevious(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const focus = normalizeFocus(v.focus);
  const summary = clip(v.summary, 400);
  let scores = null;
  if (v.scores && typeof v.scores === "object" && !Array.isArray(v.scores)) {
    const out = {};
    for (const k of SCORE_KEYS) {
      const raw = v.scores[k];
      // null·빈 문자열은 Number()가 0이 되므로 숫자/숫자문자열만 받는다
      if (typeof raw !== "number" && !(typeof raw === "string" && raw.trim() !== "")) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(10, Math.round(n)));
    }
    if (Object.keys(out).length > 0) scores = out;
  }
  if (!focus && !summary && !scores) return null;
  return { focus, summary, scores };
}

// 요청마다 달라지는 부분 — 시스템 블록이 아니라 user 콘텐츠 끝에 붙인다(캐시 프리픽스 보존).
export function buildContextBlock({ focus, previous, isPremium }) {
  const parts = [];
  if (focus) {
    parts.push(
      `[이번 연습의 초점]
사용자가 이번 연습 전에 고른 초점: ${focus}
→ 🎯 섹션을 이 초점 중심으로 쓰세요. 이 초점이 이번 기록에서 실제로 어떻게 나타났는지부터 짚고, 다음 한 걸음을 제시하세요.`
    );
  }
  if (previous) {
    const lines = [];
    if (previous.focus) lines.push(`지난 연습에서 고른 초점: ${previous.focus}`);
    if (previous.summary) lines.push(`지난 피드백 요약: ${previous.summary}`);
    if (previous.scores) {
      lines.push(
        `지난 활동 지표(내부 수치 — 사용자에게 말하지 말 것): ${SCORE_KEYS.map(
          (k) => `${k}=${previous.scores[k] ?? "-"}`
        ).join(" ")}`
      );
    }
    parts.push(
      `[지난 연습 기록]
${lines.join("\n")}
→ 피드백 본문에 🔁 섹션을 하나 추가하세요(🎯 섹션 바로 다음). 지난 초점이 이번 기록에서 어떻게 달라졌는지를, 이번 기록의 구절·구간을 근거로 쓰세요. 좋아졌다고 단정하지 말고 관찰된 변화만 쓰고, 변화가 안 보이면 안 보인다고 쓰세요.
→ 분량: ${isPremium ? "3~4문장." : "정확히 한 문장. 두 문장을 넘기지 마세요."}`
    );
  }
  return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  if (!checkAppToken(req)) return rejectAppToken(res);

  // 사용량 판정 — 로그인 유저는 Authorization, 게스트는 X-Device-Id로 식별
  const user = await identifyUser(req);
  let guestId = null;
  let isPremium = false;
  if (user) {
    const quota = await checkTextQuota(user.id);
    isPremium = !!quota.premium;
    if (!quota.allowed) {
      return res.status(429).json({
        error: "quota_exceeded",
        type: "text_daily",
        used: quota.used,
        max: quota.max,
      });
    }
  } else {
    guestId = identifyGuest(req);
    if (guestId) {
      const gq = await checkGuestQuota(guestId);
      if (!gq.allowed) {
        return res.status(429).json({
          error: "quota_exceeded",
          type: "guest_trial",
          used: gq.used,
          max: gq.max,
        });
      }
    }
  }

  try {
    const { prompt, field, noteTitle, noteLocalId, wantScores, wantFocus, frames, focus, previous } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    // 동의 기반 첨부 사진 보관 (kind='photo') — 노트당 최대 8장, 초과분은 로그.
    // AI 응답 성공 여부와 독립적으로 보관. 미동의·프레임 없음이면 스킵.
    if (hasDataConsent(req) && Array.isArray(frames) && frames.length > 0) {
      const saved = await archivePhotos(frames, {
        userId: user?.id,
        noteLocalId: noteLocalId || null,
        field: field || null,
        titleHash: titleHash(noteTitle),
      });
      if (saved) console.log(`[ai-analyze] archived ${saved} photo(s)`);
    }

    const systemPrompt = buildSystemPrompt(field, wantScores, wantFocus === true);

    // 프롬프트 캐싱: 고정 부분(역할+규칙+few-shot)은 cache_control로 캐싱
    // Sonnet 4.6 최소 캐시 프리픽스 2048토큰 — 캐시 동작은 usage 로그로 확인
    const systemBlocks = [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];

    // 비한국어 노트 감지 → 응답 언어 강제 (한국어 few-shot이 지배적이라 명시 블록 필요)
    const hangulCount = (prompt.match(/[가-힣]/g) || []).length;
    const cjkCount = (prompt.match(/[ぁ-んァ-ヶ一-龯]/g) || []).length; // 일본어·중국어
    const latinCount = (prompt.match(/[A-Za-z]/g) || []).length;
    const langTotal = hangulCount + cjkCount + latinCount;
    const isNonKorean = langTotal > 30 && hangulCount / langTotal < 0.15;
    if (isNonKorean) {
      systemBlocks.push({
        type: "text",
        text: "CRITICAL OVERRIDE — RESPONSE LANGUAGE: The user's note is NOT written in Korean. You MUST write your ENTIRE feedback in the same language as the user's note (English note → English feedback, Indonesian → Indonesian, Japanese → Japanese, etc.). Do NOT write in Korean under any circumstances. The Korean examples above are for structure and quality reference only — keep the emoji section format, but write every sentence in the user's language.",
      });
    }

    // 첨부 사진(frames) 처리 — 각 원소는 순수 base64 JPEG 문자열(analyze-video.js와 동일 규약).
    // 있으면 비전 블록(이미지들 뒤 텍스트)로 구성, 없으면 기존처럼 텍스트만 → 구버전 앱 호환.
    // 이번 초점·지난 연습은 요청마다 달라지므로 시스템(캐시 프리픽스)이 아니라 user 텍스트 끝에 붙인다.
    const promptText =
      prompt +
      buildContextBlock({
        focus: normalizeFocus(focus),
        previous: normalizePrevious(previous),
        isPremium,
      });

    const hasFrames = Array.isArray(frames) && frames.length > 0;
    const userContent = hasFrames
      ? [
          ...frames.map((base64) => ({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: base64 },
          })),
          { type: "text", text: promptText },
        ]
      : promptText;

    const wantsStream = req.query && (req.query.stream === "1" || req.query.stream === "true");

    // ── 스트리밍 경로 (앱이 ?stream=1 로 요청) ──
    // 구버전은 청크 텍스트, protocol=events는 완료/실패를 구분하는 NDJSON.
    if (wantsStream) {
      const events = req.query.protocol === "events";
      const writeEvent = (event) => res.write(JSON.stringify(event) + "\n");
      res.setHeader("Content-Type", events ? "application/x-ndjson; charset=utf-8" : "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      // 생성 메타 — 앱이 노트 저장 시 함께 기록 (스트림은 본문이 텍스트라 헤더로 전달)
      const chain = paramChain(isPremium);
      res.setHeader("X-AL-Prompt-Version", PROMPT_VERSION);
      let full = "";
      let usedModel = null;
      let completed = false;
      try {
        // 프리미엄(Opus 5) 실패·거절 시 무료 모델(Sonnet 5)로 1회 재시도 — 본문이 아직 안 나간 경우에만
        for (const params of chain) {
          try {
            const stream = await client.messages.stream({
              ...params,
              system: systemBlocks,
              messages: [{ role: "user", content: userContent }],
            });
            for await (const event of stream) {
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                // 첫 본문을 내보내기 전까지 폴백 모델의 실제 이름으로 헤더를 갱신한다.
                if (!res.headersSent) res.setHeader("X-AL-Model", params.model);
                if (events) writeEvent({ type: "delta", text: event.delta.text });
                else res.write(event.delta.text);
                full += event.delta.text;
              }
            }
            const finalMsg = await stream.finalMessage();
            console.log("[ai-analyze] stream usage:", params.model, JSON.stringify(finalMsg.usage));
            if (isRefusal(finalMsg) && !full.length) {
              console.error("[ai-analyze] refusal:", params.model, JSON.stringify(finalMsg.stop_details || {}));
              continue;
            }
            if (events && isRefusal(finalMsg)) throw new Error("analysis_refused");
            if (finalMsg.stop_reason === "max_tokens") {
              if (events) throw new Error("analysis_truncated");
              res.write("\n\n…"); // 본문에 쓴 글은 그대로 노트에 저장된다 — 언어 중립 표시만
            }
            if (events && !["end_turn", "stop_sequence"].includes(finalMsg.stop_reason)) throw new Error("analysis_not_finished");
            usedModel = finalMsg.model || params.model;
            completed = true;
            break;
          } catch (modelErr) {
            console.error("[ai-analyze] stream model error:", params.model, modelErr.status, modelErr.message);
            if (full.length) throw modelErr; // 공백이라도 이미 나갔으면 메타/본문을 다른 모델과 섞지 않는다
          }
        }
        if (!completed || full.trim().length < 10) throw new Error("empty analysis");
        if (user) await consumeText(user.id, { strict: events });
        else if (guestId) await consumeGuest(guestId, { strict: events });
        else if (events) throw new Error("usage_identity_missing");
        // 신버전은 공급자의 완료와 사용량 기록까지 확인된 뒤에만 최종 결과를 저장한다.
        if (events) writeEvent({ type: "done", model: usedModel, promptVersion: PROMPT_VERSION });
      } catch (streamErr) {
        console.error("[ai-analyze] stream error:", streamErr.message);
        if (events) writeEvent({ type: "error", error: "analysis_incomplete" });
        // 구버전 plain 스트림에는 오류 문구를 본문으로 섞지 않는다.
        // 신버전은 error 또는 done 없는 종료를 실패로 처리하고 이전 결과를 보존한다.
      }
      return res.end();
    }

    // ── 비스트리밍 경로 (구버전 앱 호환) ──
    let msg = null;
    let usedModel = null;
    for (const params of paramChain(isPremium)) {
      try {
        const m = await client.messages.create({
          ...params,
          system: systemBlocks,
          messages: [{ role: "user", content: userContent }],
        });
        console.log("[ai-analyze] usage:", params.model, JSON.stringify(m.usage)); // 캐시·비용 모니터링
        if (isRefusal(m)) {
          console.error("[ai-analyze] refusal:", params.model, JSON.stringify(m.stop_details || {}));
          continue;
        }
        msg = m;
        usedModel = params.model;
        break;
      } catch (modelErr) {
        console.error("[ai-analyze] model error:", params.model, modelErr.status, modelErr.message);
      }
    }
    if (!msg) return res.status(500).json({ error: "AI analysis failed" });

    const rawText = textOf(msg);
    // 프리필 제거 후 모델이 직접 📌로 시작 — 혹시 누락하면 보정 (앱 UI 일관성)
    let analysis = rawText.startsWith("📌") ? rawText : "📌 " + rawText;

    // If truncated, append closing so it doesn't end abruptly
    if (msg.stop_reason === "max_tokens") {
      analysis += "\n\n---\n(분석이 길어져 일부 생략되었습니다)";
    }

    if (!analysis || analysis.trim().length < 10) {
      return res.status(500).json({ error: "Empty response from AI" });
    }

    if (user) await consumeText(user.id); // 성공 시에만 카운트 (await로 서버리스 freeze 전 저장 보장)
    else if (guestId) await consumeGuest(guestId);
    return res
      .status(200)
      .json({ analysis, meta: { model: usedModel, promptVersion: PROMPT_VERSION } });
  } catch (error) {
    console.error("[ai-analyze] Error:", error.message, error.status, error.body);
    return res.status(500).json({ error: "AI analysis failed", detail: error.message });
  }
}
