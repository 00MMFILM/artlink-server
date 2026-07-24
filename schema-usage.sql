-- 수익화 사용량 테이블 (2026-07-24)
-- Supabase SQL Editor에서 실행: https://supabase.com/dashboard/project/ayvfdomoghppgrleugnk/sql
-- 구조: 텍스트 무료 1일 1회 + 광고크레딧 +2 / 영상 평생 3회 / premium_members 등재 시 무제한

-- 일별 텍스트 사용량 + 광고 크레딧 (KST 기준 day)
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id UUID NOT NULL,
  day DATE NOT NULL,
  text_count INT NOT NULL DEFAULT 0,
  ad_credits INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

-- 영상 분석 평생 사용량
CREATE TABLE IF NOT EXISTS ai_video_usage (
  user_id UUID PRIMARY KEY,
  total_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 무제한 명단: kind = 'comp'(베타/지정 무료) | 'sub'(유료 구독 — 추후 RevenueCat 웹훅이 관리)
CREATE TABLE IF NOT EXISTS premium_members (
  user_id UUID PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'comp',
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 서비스 키(서버)만 접근 — 클라이언트 직접 접근 차단
ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_video_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_members ENABLE ROW LEVEL SECURITY;
