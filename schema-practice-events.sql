-- 반복 연습 이벤트 (2단계, 2026-09-13)
-- Supabase SQL Editor에서 실행: https://supabase.com/dashboard/project/ayvfdomoghppgrleugnk/sql
-- 목적: "첫 연습을 마친 사람이 7일 안에 다시 연습했는가"를 기기 기준(게스트 포함)으로 측정.
-- 기존 funnel_events(기기당 이벤트 최초 1회)는 그대로 두고, 여기는 append-only로 매번 쌓는다.
-- 대본·노트 본문·녹음·영상·전사는 절대 저장하지 않는다 — subject_key는 카탈로그 장면 id나
-- 앱 로컬 노트 id(숫자)뿐이라 내용 복원이 불가능해야 한다. 설계안 §3·§6 참조.

CREATE TABLE IF NOT EXISTS practice_events (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  auth_user_id UUID,
  event TEXT NOT NULL
    CHECK (event IN ('practice_started', 'practice_completed', 'ai_feedback_done')),
  kind TEXT NOT NULL
    CHECK (kind IN ('text', 'video', 'checkin', 'duet', 'reanalysis')),
  session_id UUID NOT NULL,
  client_event_id UUID NOT NULL,
  subject_key TEXT,
  field TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  app_version TEXT,
  platform TEXT CHECK (platform IN ('ios', 'android')),
  language TEXT,
  UNIQUE (device_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_practice_events_device_time ON practice_events(device_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_practice_events_event_time ON practice_events(event, occurred_at);

-- 서비스 키(서버)만 접근 — 클라이언트 직접 접근 차단
ALTER TABLE practice_events ENABLE ROW LEVEL SECURITY;
-- RLS 정책 없음 = anon 읽기·쓰기 전부 차단 (service key만 통과)

-- 7일 재연습 코호트 (설계안 §5). 첫 practice_completed 발생 주(cohort_week)별로
-- 그 기기가 7일 안에 다시 practice_completed를 냈는지 비율로 집계.
CREATE OR REPLACE VIEW practice_repeat_7d AS
WITH first_done AS (
  SELECT device_id, MIN(occurred_at) t0
  FROM practice_events
  WHERE event = 'practice_completed'
  GROUP BY device_id
), again AS (
  SELECT f.device_id,
    BOOL_OR(p.occurred_at > f.t0 + INTERVAL '1 minute' AND p.occurred_at <= f.t0 + INTERVAL '7 days') AS repeat7
  FROM first_done f
  JOIN practice_events p
    ON p.device_id = f.device_id AND p.event = 'practice_completed'
  GROUP BY f.device_id
)
SELECT
  DATE_TRUNC('week', f.t0) AS cohort_week,
  COUNT(*) AS devices,
  COUNT(*) FILTER (WHERE a.repeat7) AS repeated_7d,
  ROUND(100.0 * COUNT(*) FILTER (WHERE a.repeat7) / COUNT(*), 1) AS pct
FROM first_done f
JOIN again a USING (device_id)
GROUP BY 1
ORDER BY 1;

-- 같은 장면(subject_key) 재연습 — 첫 완료와 같은 subject_key로 7일 안에 재완료했는가.
-- subject_key가 없는 첫 완료(체크인 등)는 비교 기준이 없어 제외한다.
CREATE OR REPLACE VIEW practice_repeat_same_subject_7d AS
WITH first_done AS (
  SELECT DISTINCT ON (device_id) device_id, occurred_at AS t0, subject_key
  FROM practice_events
  WHERE event = 'practice_completed' AND subject_key IS NOT NULL
  ORDER BY device_id, occurred_at
), again AS (
  SELECT f.device_id,
    BOOL_OR(p.occurred_at > f.t0 + INTERVAL '1 minute' AND p.occurred_at <= f.t0 + INTERVAL '7 days') AS repeat7
  FROM first_done f
  JOIN practice_events p
    ON p.device_id = f.device_id
   AND p.event = 'practice_completed'
   AND p.subject_key = f.subject_key
  GROUP BY f.device_id
)
SELECT
  DATE_TRUNC('week', f.t0) AS cohort_week,
  COUNT(*) AS devices,
  COUNT(*) FILTER (WHERE a.repeat7) AS repeated_7d,
  ROUND(100.0 * COUNT(*) FILTER (WHERE a.repeat7) / COUNT(*), 1) AS pct
FROM first_done f
JOIN again a USING (device_id)
GROUP BY 1
ORDER BY 1;
