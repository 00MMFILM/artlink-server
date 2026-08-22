-- 「아르스 Ars」 게임 전용 AI 판정 카운터 (2026-08-22).
-- 앱의 guest_ai_usage와 분리한다 — 게임이 앱 무료 체험을 태우면 퍼널이 자멸한다.
-- key = X-Game-Id 헤더 또는 "ip:<주소>". 서버(service key)만 접근.
CREATE TABLE IF NOT EXISTS game_ai_usage (
  key TEXT NOT NULL,
  day DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (key, day)
);

ALTER TABLE game_ai_usage ENABLE ROW LEVEL SECURITY;
-- RLS 정책 없음 = anon 접근 차단 (service key만 통과)
