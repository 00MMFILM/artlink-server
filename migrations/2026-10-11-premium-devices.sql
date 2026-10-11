-- 가입 전 게스트 기기에 대표가 직접 프리미엄(무제한)을 주는 명단.
-- premium_members는 계정(user_id) 기준이라 게스트를 못 넣는다. 서버(service key)만 읽는다.
create table if not exists public.premium_devices (
  device_id text primary key,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.premium_devices enable row level security;
