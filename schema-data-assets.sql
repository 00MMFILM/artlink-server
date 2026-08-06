-- 데이터 자산화 스키마 (2026-08-06)
-- 목적: 노트-피드백 데이터를 미래 AI 학습 자산으로 축적
-- 적용: Supabase SQL Editor에서 실행
-- 관련: schema-usage.sql (사용량 판정)

-- 1) user_notes: 생성 메타 + 전사 원문 보존
--    ai_model/prompt_version: 어떤 모델·프롬프트가 만든 피드백인지 (품질 비교·학습 필터용)
--    transcript: Whisper 전사 원문 (영상·음성의 텍스트 기록 — 원본 삭제 후에도 남는 입력 데이터)
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS transcript TEXT;

-- 2) 피드백 평가 (👍/👎 + 이유) — 학습 데이터 라벨의 시작점
CREATE TABLE IF NOT EXISTS feedback_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                  -- auth uuid 또는 게스트 'dev:{deviceId}' (게스트도 평가 수집)
  note_local_id TEXT NOT NULL,            -- 앱 로컬 노트 ID (user_notes.local_id 대응)
  feedback_kind TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'video'
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  reason TEXT,                            -- 👎 시: 'generic' | 'irrelevant' | 'wrong' | 'too_long'
  ai_model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, note_local_id, feedback_kind)  -- 노트당 1회, 재평가는 upsert
);

ALTER TABLE feedback_ratings ENABLE ROW LEVEL SECURITY;
-- 서버(service key)만 쓰기 — 앱은 API 경유. RLS 정책 없음 = anon 접근 차단

-- 3) 원본 보존 버킷 (private — temp-media와 달리 공개 접근 불가)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media-archive', 'media-archive', false)
ON CONFLICT (id) DO NOTHING;

-- 4) 프리미엄 공정사용 — 영상 월 상한(15회) 판정용 일별 카운트 (2026-08-06 추가)
ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS video_count INT DEFAULT 0;
