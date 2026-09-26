-- 연습 이탈 계측 (1.11.8, 2026-09-26)
--
-- 배경: 연습 시작 → 완료가 21%다. 어디서 얼마나 붙들다 그만두는지 모르면 고칠 수 없어,
--       완료 없이 화면을 떠난 세션을 practice_abandoned 1건으로 남기고 완료·이탈에
--       걸린 시간(elapsed_ms)을 같이 받는다.
--
-- 이 SQL 실행 전에도 서버는 죽지 않는다 — api/practice-event.js가 컬럼 부재(42703/PGRST204)와
-- CHECK 위반(23514)을 감지해 elapsed_ms·practice_abandoned를 덜어내고 다시 넣는다.
-- 실행하고 나면 첫 시도에서 그대로 저장되고, 그때부터 이탈·소요시간 집계가 시작된다.

ALTER TABLE practice_events
  ADD COLUMN IF NOT EXISTS elapsed_ms integer;

-- event CHECK에 practice_abandoned 추가 (기존 제약을 바꿔 끼운다)
ALTER TABLE practice_events DROP CONSTRAINT IF EXISTS practice_events_event_check;
ALTER TABLE practice_events ADD CONSTRAINT practice_events_event_check
  CHECK (event IN ('practice_started', 'practice_completed', 'ai_feedback_done', 'practice_abandoned'));
