-- ✅ 2026-09-23 대표가 운영 DB에 실행 완료(컬럼 존재 실측 확인). 재실행은 IF NOT EXISTS로 안전.
-- 프로필 공개 여부 서버 영속화 (2026-09-23)
--
-- 배경: 앱에서 공개를 끄면 업로드만 멈추고 서버 행은 그대로 남았다. 공개 여부 컬럼 자체가
--       없어서 다른 기기의 늦은 동기화가 프로필을 되살렸고, B2B 브라우징에도 계속 노출됐다.
--
-- 정책:
--  - profile_public = false 는 "묘비 행". 행을 지우지 않고 개인정보 컬럼만 비운다.
--    (행을 지우면 뒤늦게 도착한 업로드가 통째로 새로 만들어 되살린다)
--  - visibility_updated_at 은 단조 증가. 이 값보다 오래된 요청은 서버가 무시한다.
--  - 기존 행은 전부 공개(true)로 간주한다 → NOT NULL DEFAULT TRUE.
--    NULL을 허용하지 않아야 api/artist-browse.js의 neq(profile_public,false) 필터가
--    기존 행을 잘못 감추지 않는다.
--
-- 관련 코드: api/profile-sync.js(수신·묘비 처리), api/artist-browse.js(비공개 제외)
--           scripts/test-profile-visibility.js(오프라인 회귀)
-- 이 SQL 실행 전에도 서버는 죽지 않는다 — 컬럼 부재 시 기존 동작으로 폴백한다.

ALTER TABLE artist_profiles
  ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE artist_profiles
  ADD COLUMN IF NOT EXISTS visibility_updated_at TIMESTAMPTZ;

-- 브라우징은 공개 행만 읽는다 — 비공개 묘비 행이 늘어도 스캔 비용이 커지지 않게.
CREATE INDEX IF NOT EXISTS artist_profiles_public_idx
  ON artist_profiles (score DESC)
  WHERE profile_public;
