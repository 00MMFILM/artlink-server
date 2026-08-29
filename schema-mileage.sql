-- ⚠️ 이 SQL을 Supabase(SQL Editor)에서 실행해야 마일리지·레벨이 저장된다.
--    실행 전에는 api/profile-sync.js가 mileage/level 컬럼 없이 방어적으로 폴백 동작한다
--    (해당 두 필드만 빼고 upsert 재시도 — 프로필 동기화 자체는 깨지지 않음).
-- 연습 마일리지·레벨 스키마 (2026-08-29)
-- 배경: 종합점수(0~100)는 3~4주면 포화돼 성장 신호가 멈춘다. 점수는 그대로 두고
--       누적·무상한·감소불가인 마일리지·레벨을 추가한다.
-- 관련: api/_mileage.js (계산 로직), api/profile-sync.js (upsert), api/artist-browse.js (노출),
--       scripts/backfill-scores.js (백필)

ALTER TABLE artist_profiles ADD COLUMN IF NOT EXISTS mileage INTEGER DEFAULT 0;
ALTER TABLE artist_profiles ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;

-- B2B 대시보드 등에서 레벨 기준 정렬/필터에 사용
CREATE INDEX IF NOT EXISTS artist_profiles_level_idx ON artist_profiles (level DESC);
