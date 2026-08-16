-- 스마트링크(art-link.kr/app) 클릭 로깅 — 유입원 attribution (Threads 등).
-- 서버(service key)만 기록·조회. 앱/외부 직접 접근 없음.
CREATE TABLE IF NOT EXISTS link_clicks (
  id BIGSERIAL PRIMARY KEY,
  link TEXT,
  source TEXT,        -- 'threads' | 'direct' | ...
  platform TEXT,      -- 'ios' | 'android' | 'desktop'
  referer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_link_clicks_created ON link_clicks(created_at DESC);
ALTER TABLE link_clicks ENABLE ROW LEVEL SECURITY;
-- RLS 정책 없음 = anon 차단 (service key만)
