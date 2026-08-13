-- 게스트(비로그인) AI 체험 카운터 — deviceId 기준 평생 1회 (텍스트+영상 공유).
-- 서버(service key)만 접근. 앱은 X-Device-Id 헤더로 판정 요청, 직접 접근 없음.
CREATE TABLE IF NOT EXISTS guest_ai_usage (
  device_id TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE guest_ai_usage ENABLE ROW LEVEL SECURITY;
-- RLS 정책 없음 = anon 접근 차단 (service key만 통과)
