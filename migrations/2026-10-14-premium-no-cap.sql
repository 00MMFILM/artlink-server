-- 대표가 직접 지정한 개인은 프리미엄 공정사용 상한(텍스트 10/일·영상 15/월) 없이 쓴다
alter table public.premium_members add column if not exists no_cap boolean not null default false;
