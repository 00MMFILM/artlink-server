-- ⚠️ 이 SQL을 Supabase(SQL Editor)에 실행해야 media_assets 적재·RLS가 작동한다.
--    실행 전에는 서버의 media_assets upsert/삭제 REST 호출이 조용히 실패한다(테이블 없음).
-- 동의 기반 학습자산 보관 스키마 (2026-08-27)
-- 관련: schema-data-assets.sql (media-archive 버킷 INSERT는 그쪽에 이미 있음 — 여기선 정책만 보강)
--       api/_archive.js (적재·삭제 로직), api/media-consent-withdraw.js (철회)

-- 1) media_assets: 동의 보관된 원본(음성/영상/사진)의 메타 인덱스
--    원본 바이너리는 storage(media-archive)에 있고, 이 표는 소유자·노트·종류·경로를 가리킨다.
CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                 -- auth uuid (게스트는 'anon')
  note_local_id TEXT,                    -- 앱 로컬 노트 ID (연결용, null 가능)
  field TEXT,                            -- 분야(acting/music/...) — null 가능
  title_hash TEXT,                       -- 노트 제목 해시(원문 미저장) — null 가능
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'video', 'photo')),
  storage_path TEXT NOT NULL,            -- media-archive 버킷 내 객체 키
  consent_at TIMESTAMPTZ,                -- 동의 시각(보관 시점)
  ai_scores JSONB,                       -- 5축 점수 등 분석 메타 — null 가능
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (storage_path)                  -- 같은 객체 재기록은 upsert(merge)로 idempotent
);

CREATE INDEX IF NOT EXISTS media_assets_user_idx ON media_assets (user_id);

-- 2) RLS: service_key(서버) 전용. 정책을 하나도 만들지 않음 = anon/authenticated 클라이언트 전면 차단.
--    (service key는 RLS를 우회하므로 서버 API 경유 접근만 가능. 앱은 절대 이 표에 직접 접근 못 함)
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

-- 3) media-archive 버킷 private 보장 (버킷 생성은 schema-data-assets.sql에 이미 있음 — 여기선 상태만 강제)
--    public=false면 익명 CDN 경로가 비활성화되고, storage.objects의 RLS 기본 정책이 없으면 anon 접근 불가.
UPDATE storage.buckets SET public = false WHERE id = 'media-archive';

-- 4) storage 정책 보강: media-archive에 대한 익명/일반 접근을 명시적으로 차단.
--    storage.objects는 기본 RLS가 켜져 있어, media-archive 버킷을 허용하는 정책이 없으면 이미 anon은 못 읽는다.
--    아래는 "이 버킷에는 허용 정책을 만들지 않는다"는 원칙을 문서로 못박는 안전장치다.
--    (다른 버킷용 광범위 정책이 실수로 추가되지 않도록 리뷰 기준으로 남김.
--     media-archive 접근은 오직 service_key로만 — 앱은 서버 API(transcribe/analyze-video/ai-analyze,
--     철회는 media-consent-withdraw)를 경유한다.)
