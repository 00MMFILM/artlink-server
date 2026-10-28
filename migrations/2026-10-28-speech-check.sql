begin;
-- Only usage metadata is retained. No original audio, transcript or analysis.
create table public.artlink_speech_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, created_at timestamptz not null default now(),
 complete boolean not null default false, primary key(user_id,request_id)
);
alter table public.artlink_speech_usage enable row level security;
revoke all on public.artlink_speech_usage from public,anon,authenticated;
grant all on public.artlink_speech_usage to service_role;
create function public.artlink_speech_limit(p_user uuid,p_request uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 perform 1 from auth.users where id=p_user for update;
 if not found or p_request is null then raise exception 'LOGIN_REQUIRED'; end if;
 delete from public.artlink_speech_usage where user_id=p_user and (created_at<now()-interval '24 hours' or (not complete and created_at<now()-interval '2 minutes'));
 if p_action='reserve' then
  if exists(select 1 from public.artlink_speech_usage where user_id=p_user and request_id=p_request) then raise exception 'SPEECH_BUSY'; end if;
  select count(*) into used from public.artlink_speech_usage where user_id=p_user;
  if used>=5 then raise exception 'SPEECH_LIMIT'; end if;
  insert into public.artlink_speech_usage(user_id,request_id) values(p_user,p_request);
 elsif p_action='complete' then
  update public.artlink_speech_usage set complete=true where user_id=p_user and request_id=p_request;
  if not found then raise exception 'SPEECH_BUSY'; end if;
 elsif p_action='release' then
  delete from public.artlink_speech_usage where user_id=p_user and request_id=p_request and not complete;
 else raise exception 'INVALID_ACTION'; end if;
 select count(*) into used from public.artlink_speech_usage where user_id=p_user;
 return jsonb_build_object('used',used,'limit',5,'windowHours',24);
end;$$;
revoke all on function public.artlink_speech_limit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.artlink_speech_limit(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
