import Anthropic from "@anthropic-ai/sdk";
import {
  checkAppToken,
  rejectAppToken,
  identifyUser,
  checkVideoQuota,
  consumeVideo,
  identifyGuest,
  checkGuestQuota,
  consumeGuest,
} from "./_usage.js";
import { hasDataConsent, copyTempToArchive, upsertMediaAsset, titleHash } from "./_archive.js";
import { evidenceInstruction } from "./_analysisEvidence.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Gemini 영상 처리(업로드+인제스트 대기)가 길 수 있어 함수 시간 상향
export const config = { maxDuration: 300 };

// 생성 메타 — 노트에 함께 저장되어 품질 비교·학습 데이터 필터의 기준이 된다
import { paramChain, textOf, isRefusal } from "./_model.js";
// 초점·비교 규약은 ai-analyze.js와 한 곳에서 관리한다 (두 엔드포인트가 같은 숨김 줄 계약을 쓴다)
import { FOCUS_INSTRUCTION, normalizeFocus, normalizePrevious, buildContextBlock } from "./ai-analyze.js";
const PROMPT_VERSION = "2026-09-26.1";

// ── Gemini 영상 관찰 경로 ──
// 프레임 요약의 한계(움직임·소리 증발)를 보완: 영상을 통째로 Gemini가 시청·청취하고
// 타임스탬프 관찰 기록을 작성 → Sonnet이 기존 코칭 프레임워크로 문장화.
// GEMINI_API_KEY 미설정, 실패, 구버전 앱(videoUrl 없음)이면 기존 프레임 경로로 폴백.
const GEMINI_KEY = process.env.GEMINI_API_KEY;
// gemini-flash-latest: 항상 현행 Flash를 가리키는 별칭 — 특정 버전 폐기에 영향 없음
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MAX_BYTES = 1024 * 1024 * 1024; // 1GB (1080p 5분 여유) — 초과 시 프레임 경로로

async function geminiUploadVideo(videoUrl) {
  // 크기는 HEAD로 먼저 확인 (본문은 스트리밍으로 흘려보내 메모리에 안 올림)
  const head = await fetch(videoUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`video HEAD ${head.status}`);
  const size = Number(head.headers.get("content-length") || 0);
  if (!size || size > GEMINI_MAX_BYTES) throw new Error(`video size unsupported: ${size}`);

  // Files API resumable 업로드 (start → upload+finalize)
  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": "video/mp4",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "artlink-video" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error(`gemini upload start ${start.status}`);

  // Supabase → Gemini 스트리밍 릴레이 (버퍼링 없음)
  const vres = await fetch(videoUrl);
  if (!vres.ok || !vres.body) throw new Error(`video fetch ${vres.status}`);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: vres.body,
    duplex: "half", // Node fetch 스트림 바디 필수 옵션
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

// 분야별 관찰 체크리스트 — 미술(작업 과정)·영화(촬영물)는 공연용 체크리스트로는 핵심을 놓침
const OBS_FOCUS = {
  acting:
    "①움직임·동작의 질 (전환의 부드러움, 템포, 연결, 자세 변화) ②표정·시선 변화 ③음성 — 실제 들리는 소리 기준 (음정, 억양 곡선, 말 속도 변화, 쉼의 위치와 길이, 떨림, 볼륨 변화) ④소리와 동작의 타이밍 관계 ⑤전체 감정 흐름(아크)",
  dance:
    "①동작의 질 (전환, 템포, 연결, 레벨 변화, 회전·점프·착지의 처리) ②공간 활용과 이동 경로 ③음악과 동작의 싱크 (비트 정확도, 악센트 처리) ④에너지 다이내믹의 변화 ⑤호흡과 동작의 관계",
  music:
    "①들리는 소리 최우선 — 음정 정확도, 리듬 안정성, 다이내믹 변화, 음색, 프레이징 ②보컬이면 발성 (호흡, 음역 전환, 비브라토, 지지) ③연주 자세와 손·팔 움직임, 불필요한 긴장 부위 ④소리와 몸의 관계 ⑤곡 전체의 감정 흐름",
  art: "①붓터치·도구 사용의 방향, 속도, 압력 변화 ②색 혼합과 레이어를 쌓는 순서 ③구도·명암이 작업 중 어떻게 변해가는지 (초반↔후반 화면 비교) ④작업 리듬 (몰입 구간, 물러나서 관찰하는 순간, 머뭇거림) ⑤화면 전체의 톤 변화",
  film: "①숏 사이즈와 앵글, 카메라 무빙의 종류와 안정성 ②조명의 방향·대비와 색감 ③컷 전환의 타이밍과 리듬 ④들리는 소리 — 대사 전달력, 앰비언스, 음악의 기능 ⑤장면 전체의 서사·감정 흐름",
  literature:
    "①낭독 음성 — 억양 곡선, 속도 변화, 쉼의 위치와 길이, 볼륨 변화 ②문장 리듬과 호흡점 ③감정 표현의 변화 ④발음 명료도 ⑤전체 낭독의 감정 흐름(아크)",
};

async function geminiObserve(fileUri, field) {
  const focus = OBS_FOCUS[field] || OBS_FOCUS.acting;
  const obsPrompt = `당신은 공연·영상 분석 전문가입니다. 이 영상을 처음부터 끝까지 보고 들은 뒤, 코칭의 근거가 될 관찰 기록을 작성하세요.

규칙:
- 모든 관찰에 시각을 붙이세요 (예: [0:42])
- 다음을 관찰하세요: ${focus}
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
  acting: `[영상 분석 예시 — 가상의 서버 관찰: “[0:12] 상대 쪽을 보다가 고개를 돌림. [0:18] 마지막 단어가 앞부분보다 작게 들림.” 실제 입력에 같은 관찰이 있을 때만 해당 내용을 인용하세요.]
📌 0:12에는 고개를 돌리는 행동, 0:18에는 마지막 단어가 앞부분보다 작게 들리는 변화가 기록돼 있어요. 이번에는 근거가 있는 이 두 지점에 집중하겠습니다.
💪 고개를 돌리기 전과 후를 비교할 위치가 분명해요. 이 행동을 어느 대사와 연결하고 싶은지 정하면 다음 테이크의 목표가 구체적이 됩니다.
🎯 같은 대사에서 고개를 돌리는 위치만 바꾼 버전을 만들어보세요. 나머지 동작과 촬영 구도는 그대로 유지하면 됩니다.
🎤 0:18의 마지막 단어를 직접 다시 들으며, 끝을 작게 처리하는 선택이 전달하려던 뜻과 맞는지 확인하세요. 소리를 바꾸는 실험은 고개 방향의 비교를 마친 뒤 따로 진행하면 좋겠습니다.
📈 다음 비교에서는 고개가 돌아가는 순간이 어느 단어와 겹치는지, 상대를 보던 시간이 달라졌는지 확인하세요.
🔜 우선 “고개를 돌리는 위치 하나 바꾸기”로 같은 짧은 구간을 다시 촬영하세요.`,

  dance: `[영상 분석 예시 — 가상의 서버 관찰: “[0:10] 착지 뒤 오른쪽으로 한 걸음 이동. [0:14] 음악의 박 소리 뒤에 발이 바닥에 닿는 소리가 이어짐.” 실제 관찰에 없는 정확한 시간차나 몸 상태를 덧붙이지 마세요.]
📌 0:10의 착지 뒤 오른쪽 이동과 0:14의 음악·발소리 순서가 기록돼 있어요. 전체 안무의 정확도 대신 이 짧은 연결을 비교 대상으로 잡겠습니다.
💪 착지와 다음 이동을 함께 다시 볼 구간이 특정돼 있어요. 이번에는 그 구간의 끝 위치를 정해 연습 조건을 유지해보세요.
🎯 같은 동선으로 짧은 구간을 다시 촬영하세요. 속도와 방향을 동시에 바꾸기보다 먼저 정한 끝 위치에 도착하는지 확인하면 됩니다.
🎤 0:14에 기록된 박 소리와 발소리는 해당 구간을 다시 들으며 대조하세요. 두 소리의 선후 관계를 먼저 확인하고, 정확한 시간차는 별도 측정이 있을 때만 기록하면 됩니다.
📈 다음 테이크에서는 착지 뒤 어느 발로 이동했는지와 끝 위치가 같았는지 비교하세요. 이동이 달라진 지점만 표시해두면 다음 연습이 분명해집니다.
🔜 우선 같은 시작점과 끝 위치를 유지한 한 번을 남기세요.`,

  music: `[영상 분석 예시 — 가상의 서버 관찰: “[0:12] 첫 줄의 마지막 단어가 앞부분보다 크게 들림. [0:25] 다음 구절 앞에서 소리가 잠시 멈춤.” 음정 정확도나 신체 내부 상태에 관한 관찰은 없는 경우입니다.]
📌 0:12에는 마지막 단어가 앞부분보다 크게 들리고, 0:25에는 다음 구절 앞의 멈춤이 기록돼 있어요. 음정이나 발성 상태로 확대하지 않고 이 두 변화만 다루겠습니다.
💪 첫 줄 끝과 다음 구절 시작을 각각 다시 확인할 위치가 있어요. 두 구절 중 어느 부분을 먼저 바꿀지 선택하면 비교 목표를 좁힐 수 있습니다.
🎯 첫 줄의 마지막 단어가 포함된 짧은 구절부터 같은 조건으로 반복하세요. 그 단어를 어떻게 전달하고 싶은지 가사 옆에 한 줄로 적어보세요.
🎤 0:12의 단어 끝을 직접 다시 들으며 적어둔 의도와 비교하세요. 0:25의 멈춤도 가사의 뜻을 나누려는 위치와 맞는지 확인할 수 있습니다.
📈 다음 녹음에서는 같은 마이크 위치와 같은 구절을 유지하세요. 마지막 단어 처리에서 무엇을 바꿨는지와 본인이 들은 차이를 구분해 남기면 됩니다.
🔜 우선 첫 줄의 짧은 구절 한 번을 녹화해 이전 구간과 나란히 확인하세요.`,

  film: `[영상 분석 예시 — 가상의 서버 관찰: “[0:08] 넓은 구도에서 얼굴이 크게 잡힌 구도로 전환. [0:18] 배경 소리에 대사 일부가 가려져 들림.” 실제 관찰에 같은 근거가 있을 때만 인용하세요.]
📌 0:08의 구도 전환과 0:18의 대사 청취 어려움이 기록돼 있어요. 전체 영상의 평가보다 이 두 구간을 나누어 확인하겠습니다.
💪 넓은 구도와 가까운 구도를 비교할 위치가 분명해요. 얼굴을 크게 보여주려는 순간을 대본의 특정 대사나 행동과 연결해볼 수 있습니다.
🎯 먼저 0:08의 컷 위치만 바꾼 짧은 비교본을 만드세요. 같은 길이의 원본과 나란히 보며 인물의 반응을 어느 버전에서 먼저 알게 되는지 확인하면 됩니다.
🎤 0:18은 해당 대사를 직접 다시 들으며 어느 단어가 가려지는지 표시하세요. 대사와 배경음 트랙을 따로 조절할 수 있다면 표시한 구간의 균형만 바꾼 샘플을 비교해보세요.
📈 컷 위치와 소리 균형은 각각 다른 비교본으로 남기세요. 화면의 정보 전달과 대사 청취 여부를 따로 확인하면 수정의 효과를 찾기 쉽습니다.
🔜 우선 0:08의 컷 위치를 바꾼 한 버전부터 원본과 비교하세요.`,

  art: `[영상 분석 예시 — 가상의 서버 관찰: “[0:20] 붓이 화면 왼쪽에서 오른쪽으로 움직임. [0:45] 손을 멈추고 화면 밖으로 물러남.” 실제 관찰에 없는 붓의 압력이나 작업자의 의도는 추가하지 마세요.]
📌 0:20의 붓 이동과 0:45의 멈춤이 기록돼 있어요. 붓에 실린 압력이나 작업 의도는 추측하지 않고, 화면에 남은 변화부터 비교하겠습니다.
💪 붓을 움직인 구간과 멈춘 뒤를 다시 볼 위치가 분명해요. 같은 부분의 작업 전후 모습을 골라 나란히 확인할 수 있습니다.
🎯 다음 작업에서는 수정할 부분을 하나 고르고, 손대기 전과 후에 같은 구도의 사진을 남기세요. 색이나 경계 중 비교할 항목 하나를 정하면 됩니다.
🎭 작업 도중 전체 구도를 확인할 시간을 따로 정해보세요. 같은 거리에서 작품 전체를 보거나 찍으면 가까이 작업할 때 놓친 관계를 비교하기 쉽습니다.
📈 다음 기록에는 전후 사진에서 실제로 달라진 경계나 색 하나를 표시하세요. 원래 바꾸려던 부분과 실제 변화가 일치하는지가 이번 비교 기준입니다.
🔜 같은 부분의 수정 전후 사진 한 쌍과 바꾸려던 목표 한 줄을 남기세요.`,

  literature: `[영상 분석 예시 — 가상의 서버 관찰: “[0:09] 첫 문장 끝에서 목소리가 작아짐. [0:16] 다음 문장 앞에서 잠시 멈춤.” 아래 시각과 소리 변화는 실제 입력에도 명시돼 있을 때만 인용하세요.]
📌 0:09의 문장 끝 소리 변화와 0:16의 멈춤이 기록돼 있어요. 정확한 쉼 길이나 그 이유를 덧붙이지 않고, 이 지점을 낭독 원문의 문장 경계와 대조하겠습니다.
💪 문장이 끝나고 다음 문장이 시작되는 위치를 다시 확인할 수 있어요. 두 문장이 서로 어떤 관계인지 원문에 먼저 표시하면 읽는 선택을 구체화할 수 있습니다.
🎯 같은 두 문장을 낭독하면서 문장 사이를 어떻게 나눌지 한 가지 목표를 정하세요. 다른 단어의 처리는 그대로 두고 연결 부분만 바꾼 버전을 남겨보세요.
🎤 0:09의 문장 끝을 직접 다시 듣고, 작게 마무리하는 선택이 문장의 뜻과 맞는지 확인하세요. 다음 문장과 이어 읽는 버전도 별도로 비교할 수 있습니다.
📈 두 버전에서 문장 사이가 나뉘는 지점을 같은 원문에 표시하세요. 계획한 나누기를 실제로 실행했는지와 본인이 들은 의미의 차이를 따로 적으면 됩니다.
🔜 우선 두 문장 사이의 나누기 하나만 바꾸어 같은 구절을 다시 읽으세요.`,
};

// ── 요청별로 달라지지 않는 시스템 프롬프트 (프롬프트 캐시 프리픽스) ──
// focus·previous 같은 가변 내용은 여기 넣지 말 것 — user 콘텐츠로 보낸다.
export function buildVideoSystemPrompt(field, wantFocus = false, hasVideoObservation = false) {
  const fewShot = hasVideoObservation
    ? VIDEO_FEW_SHOT[field] || VIDEO_FEW_SHOT.acting
    : `[프레임 기반 작성 예시 — 아래 관찰은 형식 예시이며 이번 사용자의 사실이 아닙니다]
📌 첫 프레임과 마지막 프레임에서 시선 방향이 달라 보여요. 중간 동작의 속도는 정지 화면으로 판단하기 어렵습니다.
💪 첫 프레임에서는 인물의 얼굴과 손이 화면 안에 함께 잡혀 있어요.
🎯 다음 촬영에서는 같은 구도를 유지하고 시선을 바꾸는 지점 하나만 정해 비교해 보세요.`;

  return `당신은 ArtLink의 AI 연습 코치입니다. 사용자가 촬영한 연습/공연 영상에서 제공된 근거를 분석하여 실질적인 피드백을 제공합니다. 실제 인물의 경력이나 소속을 갖고 있다고 주장하지 마세요.

절대 규칙:
- 반드시 사용자의 요청과 동일한 언어로 답변하세요 (한국어 요청은 한국어로, 영어 요청은 영어로, 다른 언어도 그 언어 그대로). 📌 이모지로 시작하세요
- 주어진 영상 프레임과 내용을 기반으로 반드시 즉시 피드백을 제공하세요
- 확인할 수 없는 범위를 짧게 밝히고, 확인 가능한 근거로 바로 도움을 주세요
- 절대로 사용자에게 추가 정보를 요청하거나 질문하지 마세요
- 절대로 마크다운 헤딩(#, ##), 볼드(**), 목록(-)을 사용하지 마세요. 이모지 섹션 구분과 일반 텍스트만 사용하세요
- 영상 프레임에서 시각적 요소(자세, 표정, 동작, 공간 활용, 조명 등)를 구체적으로 분석하세요
- 프레임에서 실제로 관찰되는 것만 근거로 삼으세요. 보이지 않는 동작·표정·디테일을 지어내서 본 것처럼 쓰지 마세요. 프레임은 순간 포착이므로 프레임 사이 변화는 "~로 보입니다" 수준으로 신중하게 추론하세요
- 음성 전사가 있으면 대사의 단어 선택과 문장 구조를 분석할 수 있습니다. 소리 평가의 범위는 아래 근거 규칙을 따르세요
- 시간 순서에 따른 흐름 변화를 관찰하세요. 프레임 라벨에 시각(예: 1:24 시점)이 있으면 이를 활용해 구간별 변화("0:30에서 안정적이던 자세가 1:10에는…")를 구체적으로 짚으세요
- 관찰의 근거가 되는 구간을 밝히세요. 영상 관찰 기록이나 전사가 있으면 그 대사 한 토막이나 시각("1:10 지점")을 짧게 인용하고, 프레임만 있으면 몇 번째 프레임에서 본 것인지 밝히세요
- 실력 수준을 단정하거나 등급을 매기지 마세요. 합격·불합격 가능성, 캐스팅 가능성, 오디션·입시 결과 예측은 어떤 표현으로도 언급하지 마세요. 관찰된 것과 다음에 해볼 것만 쓰세요
- 내부 점수는 연습 활동을 기록하기 위한 지표일 뿐 실력 평가가 아닙니다. 점수·등급·수치를 사용자에게 말하지 마세요
- 피드백은 1200-1800자로 작성하세요. 2000자를 절대 넘기지 마세요. 각 섹션 2-3문장으로 밀도 있게 분석하세요 — 길이보다 구체성이 우선입니다
- 요청된 형식(📌💪🎯🎭🎤📈🔜)을 따르되, 근거 없는 섹션은 생략하고 각 섹션 사이에 빈 줄을 넣으세요

${fewShot}

${evidenceInstruction(hasVideoObservation)}${wantFocus ? FOCUS_INSTRUCTION : ""}`;
}

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

  // 영상 판정 — 로그인 유저는 Authorization, 게스트는 X-Device-Id로 식별
  const user = await identifyUser(req);
  let guestId = null;
  let isPremium = false;
  if (user) {
    const quota = await checkVideoQuota(user.id);
    isPremium = !!quota.premium;
    if (!quota.allowed) {
      return res.status(429).json({
        error: "quota_exceeded",
        type: "video_trial",
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
    const { prompt, field, noteTitle, noteLocalId, frames, frameTimes, videoUrl, transcript, focus, previous, wantFocus } =
      req.body;

    if (!prompt || !frames || frames.length === 0) {
      return res.status(400).json({ error: "prompt and frames are required" });
    }

    // 동의 기반 원본 영상 보관 — transcribe(음성)·gemini 성공 여부와 독립.
    // 무음 영상(전사 실패)도 videoUrl만 있으면 여기서 보관된다.
    // copyTempToArchive가 Supabase temp-media URL만 허용 → SSRF 안전. 미동의면 스킵.
    if (hasDataConsent(req) && videoUrl) {
      const archived = await copyTempToArchive(videoUrl, user?.id);
      if (archived) {
        await upsertMediaAsset({
          user_id: user?.id || "anon",
          note_local_id: noteLocalId || null,
          field: field || null,
          title_hash: titleHash(noteTitle),
          kind: "video",
          storage_path: archived.storagePath,
          consent_at: new Date().toISOString(),
        });
      }
    }

    // Gemini 영상 관찰 시도 — 실패하면 조용히 프레임 경로로 폴백
    let observation = null;
    let pipeline = "frames";
    if (videoUrl && GEMINI_KEY && typeof videoUrl === "string" && videoUrl.startsWith(process.env.SUPABASE_URL || "")) {
      try {
        const fileUri = await geminiUploadVideo(videoUrl);
        observation = await geminiObserve(fileUri, field);
        pipeline = "gemini+sonnet";
        console.log("[analyze-video] gemini observation ok:", observation.length, "chars");
      } catch (e) {
        console.error("[analyze-video] gemini path failed, fallback to frames:", e.message);
      }
    }

    const systemPrompt = buildVideoSystemPrompt(field, wantFocus === true, !!observation);

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
      userText += `\n\n[서버가 첨부한 영상 모델 관찰 — 원본 영상에서 생성한 시각별 관찰이며 오류가 있을 수 있습니다. 명시된 근거만 인용하세요]\n${observation}`;
    }
    if (transcript) {
      userText += `\n\n[음성 전사]\n${transcript}`;
    }
    // 이번 초점·지난 연습은 요청마다 달라지므로 시스템(캐시 프리픽스)이 아니라 user 텍스트 끝에 붙인다.
    userText += buildContextBlock({
      focus: normalizeFocus(focus),
      previous: normalizePrevious(previous),
      isPremium,
    });

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
    let msg = null;
    let usedModel = null;
    for (const params of paramChain(isPremium)) {
      try {
        const m = await client.messages.create({
          ...params,
          system: [
            { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
            ...(languageOverride ? [{ type: "text", text: languageOverride }] : []),
          ],
          messages: [{ role: "user", content }],
        });
        console.log("[analyze-video] usage:", params.model, JSON.stringify(m.usage)); // 캐시·비용 모니터링
        if (isRefusal(m)) {
          console.error("[analyze-video] refusal:", params.model, JSON.stringify(m.stop_details || {}));
          continue;
        }
        msg = m;
        usedModel = params.model;
        break;
      } catch (modelErr) {
        console.error("[analyze-video] model error:", params.model, modelErr.status, modelErr.message);
      }
    }
    if (!msg) return res.status(500).json({ error: "Video analysis failed" });

    const rawText = textOf(msg);
    // 프리필 제거 후 모델이 직접 📌로 시작 — 혹시 누락하면 보정 (앱 UI 일관성)
    let analysis = rawText.startsWith("📌") ? rawText : "📌 " + rawText;

    if (msg.stop_reason === "max_tokens") {
      analysis += "\n\n---\n(분석이 길어져 일부 생략되었습니다)";
    }

    if (!analysis || analysis.trim().length < 10) {
      return res.status(500).json({ error: "Empty response from AI" });
    }

    if (user) await consumeVideo(user.id); // 성공 시에만 카운트 (await로 서버리스 freeze 전 저장 보장)
    else if (guestId) await consumeGuest(guestId);
    return res
      .status(200)
      .json({ analysis, meta: { model: usedModel, promptVersion: PROMPT_VERSION, pipeline,
        audioEvidence: observation ? "video_observation" : transcript ? "transcript_only" : "none" } });
  } catch (error) {
    console.error("[analyze-video] Error:", error.message);
    return res.status(500).json({ error: "Video analysis failed" });
  }
}
