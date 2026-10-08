-- B2B 대시보드 열람 기록 (2026-10-08). 배우 38명이 공개 중인데 기업 쪽 열람·제안이 측정되지 않아 수요를 알 수 없었다.
-- 호출마다 1행(append). 누가(기기 또는 계정), 어떤 필터로, 몇 명이 나왔는지만 남긴다. 검색어 원문은 저장하지 않는다.
create table if not exists public.dashboard_views (
  id bigserial primary key,
  viewer_kind text not null check (viewer_kind in ('account','device','unknown')),
  viewer_id text,
  filters jsonb not null default '{}'::jsonb,
  result_count integer,
  app_version text,
  platform text,
  created_at timestamptz not null default now()
);
create index if not exists dashboard_views_created_idx on public.dashboard_views (created_at desc);
alter table public.dashboard_views enable row level security;
-- 앱(anon)은 읽지 못한다. 서버(service_role)만 쓴다.
