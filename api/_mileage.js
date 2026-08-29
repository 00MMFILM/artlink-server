// 연습 마일리지·레벨 서버 계산 (2026-08-29)
// 종합점수(0~100)는 3~4주면 포화돼 성장 신호가 멈춘다. 점수는 그대로 두고, 누적·무상한·감소불가인
// 마일리지·레벨을 별도로 둔다. 노트 조회는 _score.js의 fetchUserNotes를 공유해 중복 쿼리를 만들지 않는다.
//
// 공식(고정값 — 실사용자 22명으로 검증됨. 임의 변경 금지):
//   mileage = 노트수*10 + AI분석수*15 + 기록한날수*20 + 미디어수*15 + floor(총글자수/100)
//   threshold(L) = 50*L*(L+1)/2 = 25*L*(L+1)
//   level = max(1, threshold(L) <= mileage 를 만족하는 가장 큰 L)  (상한 없음)
import { fetchUserNotes } from "./_score.js";

export function thresholdForLevel(L) {
  return 25 * L * (L + 1);
}

export function levelForMileage(xp) {
  const mileage = Number.isFinite(xp) && xp > 0 ? xp : 0;
  if (mileage <= 0) return 1;
  // 근사해로 시작해 정수 경계에 정확히 맞춘다(부동소수 오차 보정).
  let L = Math.floor((-1 + Math.sqrt(1 + (4 * mileage) / 25)) / 2);
  if (L < 1) L = 1;
  while (thresholdForLevel(L + 1) <= mileage) L++;
  while (L > 1 && thresholdForLevel(L) > mileage) L--;
  return L;
}

function buildResult(mileage) {
  const level = levelForMileage(mileage);
  const curThreshold = thresholdForLevel(level);
  const nextLevelAt = thresholdForLevel(level + 1);
  const span = nextLevelAt - curThreshold;
  const progress = span > 0 ? Math.min(1, Math.max(0, (mileage - curThreshold) / span)) : 0;
  return { mileage, level, nextLevelAt, progress };
}

// 노트 목록 → { mileage, level, nextLevelAt, progress }. 노트가 없어도 0/Lv1 형태로 반환한다
// (score와 달리 null이 아님 — UI 초기 상태 표시용. 동기화 차단 여부는 serverMileageFor가 판단).
export function computeMileageFromNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return buildResult(0);

  let totalContentLength = 0;
  let aiCount = 0;
  let mediaCount = 0;
  const dateSet = new Set();

  notes.forEach((n) => {
    totalContentLength += (n.content || "").length + (n.transcript || "").length;
    if (n.ai_comment) aiCount++;
    if (n.video_analysis) mediaCount++; // 서버 가시 범위(영상분석만) — _score.js와 동일한 제약
    dateSet.add(new Date(n.created_at).toDateString());
  });

  const mileage =
    notes.length * 10 +
    aiCount * 15 +
    dateSet.size * 20 +
    mediaCount * 15 +
    Math.floor(totalContentLength / 100);

  return buildResult(mileage);
}

// 감소 불가 정책: 기존 저장값과 신규 계산값 중 큰 마일리지를 채택하고, 그 값으로 레벨을 재산정한다.
// (노트를 지워도 마일리지는 줄지 않는다 — 승인된 정책)
export function nonDecreasingMileage(existingMileage, computedMileageResult) {
  const existing = Number.isFinite(existingMileage) ? existingMileage : 0;
  const finalMileage = Math.max(existing, computedMileageResult.mileage);
  return { mileage: finalMileage, level: levelForMileage(finalMileage) };
}

// 사용자의 서버 노트로 마일리지를 계산한다. auth 연결 없음·노트 없음·조회 실패는 모두 null
// → 호출부(profile-sync)가 기존 저장값을 그대로 두게 해 동기화를 막지 않는다.
export async function serverMileageFor(supabase, userId) {
  try {
    const notes = await fetchUserNotes(supabase, userId);
    if (!notes || notes.length === 0) return null;
    return computeMileageFromNotes(notes);
  } catch (e) {
    console.error("[mileage] serverMileageFor:", e.message);
    return null;
  }
}
