-- Service API is the only caller. It verifies the JWT with auth.getUser and
-- never accepts an identity from the HTTP body. No table is public-readable.
begin;
create table public.artlink_review_rooms (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 author_name text not null default '', title text not null check(length(title) between 1 and 120), field text not null check(field in ('acting','music','art','dance','literature','film')),
 group_id uuid references public.artlink_groups(id) on delete cascade, assignment_id uuid references public.artlink_group_assignments(id) on delete cascade,
 client_id uuid not null, link_hash text, deleting boolean not null default false, created_at timestamptz not null default now(), unique(owner_id,client_id),
 check((group_id is null)=(assignment_id is null)), check(group_id is null or link_hash is null)
);
create table public.artlink_review_versions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.artlink_review_rooms(id) on delete cascade,
 client_id uuid not null, kind text not null check(kind in ('text','image','audio','video')), body text not null default '' check(length(body)<=20000),
 review_request text not null default '' check(length(review_request)<=400), change_note text not null default '' check(length(change_note)<=600),
 mime text, bytes integer not null default 0 check(bytes between 0 and 26214400), object_path text unique,
 ready boolean not null default false, created_at timestamptz not null default now(), unique(room_id,client_id)
);
create table public.artlink_review_comments (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.artlink_review_rooms(id) on delete cascade,
 version_id uuid not null references public.artlink_review_versions(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade, author_name text not null check(length(author_name) between 1 and 40),
 body text not null check(length(body) between 1 and 2000), anchor jsonb not null, resolved boolean not null default false,
 client_id uuid not null, created_at timestamptz not null default now(), unique(author_id,client_id)
);
-- Tombstones survive room/account deletion so a still-valid signed upload
-- cannot leave an orphan object behind. The hourly sweep removes it again.
create table public.artlink_review_cleanup(path text primary key,after_at timestamptz not null);
alter table public.artlink_review_cleanup enable row level security;
revoke all on public.artlink_review_cleanup from public,anon,authenticated;
grant all on public.artlink_review_cleanup to service_role;
create function public.artlink_review_enqueue_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.artlink_review_cleanup(path,after_at) select object_path,now()+interval '3 hours' from public.artlink_review_versions where room_id=old.id and object_path is not null on conflict(path) do update set after_at=excluded.after_at;
 return old;
end;$$;
revoke all on function public.artlink_review_enqueue_delete() from public,anon,authenticated;
create trigger review_room_delete_cleanup before delete on public.artlink_review_rooms for each row execute function public.artlink_review_enqueue_delete();
create index review_rooms_owner on public.artlink_review_rooms(owner_id,created_at desc);
create index review_rooms_assignment on public.artlink_review_rooms(assignment_id,created_at desc);
create index review_versions_room on public.artlink_review_versions(room_id,created_at);
create index review_comments_room on public.artlink_review_comments(room_id,created_at);
alter table public.artlink_review_rooms enable row level security;
alter table public.artlink_review_versions enable row level security;
alter table public.artlink_review_comments enable row level security;
revoke all on public.artlink_review_rooms,public.artlink_review_versions,public.artlink_review_comments from public,anon,authenticated;
grant all on public.artlink_review_rooms,public.artlink_review_versions,public.artlink_review_comments to service_role;

create function public.artlink_review_action(p_user uuid,p_action text,p_room uuid default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.artlink_review_rooms%rowtype; v public.artlink_review_versions%rowtype; c public.artlink_review_comments%rowtype;
 g public.artlink_groups%rowtype; a public.artlink_group_assignments%rowtype; k text; cid uuid; aid uuid; permitted boolean; n integer;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if p_user is not null then perform 1 from auth.users where id=p_user for update; if not found then raise exception 'LOGIN_REQUIRED'; end if; end if;
 if p_action in ('create','list') then
  if p_user is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_payload->>'assignmentId' is not null then
   select * into a from public.artlink_group_assignments where id=(p_payload->>'assignmentId')::uuid;
   select * into g from public.artlink_groups where id=a.group_id for update;
   if g.id is null or not exists(select 1 from public.artlink_group_members where group_id=g.id and user_id=p_user and removed_at is null) then raise exception 'ACCESS_DENIED'; end if;
  end if;
  if p_action='list' then
   return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,field,author_name,assignment_id,created_at,deleting,owner_id=p_user as owner from public.artlink_review_rooms where (a.id is null and owner_id=p_user) or (a.id is not null and assignment_id=a.id and (owner_id=p_user or g.owner_id=p_user)) order by created_at desc limit 100) x),'[]'::jsonb);
  end if;
  cid:=(p_payload->>'clientId')::uuid;
  if cid is null or coalesce(length(btrim(p_payload->>'title')),0) not between 1 and 120 or coalesce(p_payload->>'field','') not in ('acting','music','art','dance','literature','film') or p_payload->'consent' is distinct from 'true'::jsonb then raise exception 'INVALID_INPUT'; end if;
  select * into r from public.artlink_review_rooms where owner_id=p_user and client_id=cid;
  if found then return to_jsonb(r)-'link_hash'; end if;
  if a.id is not null and (a.closed_at is not null or a.field<>p_payload->>'field') then raise exception 'ASSIGNMENT_CLOSED_OR_FIELD'; end if;
  if (select count(*) from public.artlink_review_rooms where owner_id=p_user)>=100 then raise exception 'ROOM_LIMIT'; end if;
  insert into public.artlink_review_rooms(owner_id,author_name,title,field,group_id,assignment_id,client_id) values(p_user,coalesce((select display_name from public.artlink_group_members where group_id=g.id and user_id=p_user),''),btrim(p_payload->>'title'),p_payload->>'field',g.id,a.id,cid) returning * into r;
  return to_jsonb(r)-'link_hash';
 end if;
 select * into r from public.artlink_review_rooms where id=p_room for update;
 if r.id is null then raise exception 'NOT_FOUND'; end if;
 if r.group_id is not null then
  select * into g from public.artlink_groups where id=r.group_id for update;
  permitted:=p_user is not null and (r.owner_id=p_user or g.owner_id=p_user) and exists(select 1 from public.artlink_group_members where group_id=g.id and user_id=p_user and removed_at is null);
 else permitted:=coalesce(r.owner_id=p_user,false) or (r.link_hash is not null and r.link_hash=p_payload->>'linkHash'); end if;
 -- A removed group member can still delete their own work/account.
 if r.owner_id=p_user and p_action in ('begin_delete','paths','delete') then permitted:=true; end if;
 if not coalesce(permitted,false) then raise exception 'ACCESS_DENIED'; end if;
 if r.deleting and p_action not in ('begin_delete','paths','delete') then raise exception 'NOT_FOUND'; end if;
 if p_action='read' then
  return jsonb_build_object('room',to_jsonb(r)-'link_hash'-'owner_id'-'client_id','owner',coalesce(r.owner_id=p_user,false),'versions',coalesce((select jsonb_agg(to_jsonb(x)-'object_path'-'client_id' order by x.created_at,x.id) from public.artlink_review_versions x where room_id=r.id and ready),'[]'::jsonb),'comments',coalesce((select jsonb_agg((to_jsonb(x)-'author_id'-'client_id')||jsonb_build_object('can_delete',coalesce(x.author_id=p_user or r.owner_id=p_user,false)) order by x.created_at,x.id) from public.artlink_review_comments x where room_id=r.id),'[]'::jsonb));
 end if;
 if p_action='media' then
  select * into v from public.artlink_review_versions where id=(p_payload->>'versionId')::uuid and room_id=r.id and ready;
  if v.object_path is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('path',v.object_path);
 end if;
 if p_user is null then raise exception 'LOGIN_REQUIRED'; end if;
 if p_action='comment' then
  select * into v from public.artlink_review_versions where id=(p_payload->>'versionId')::uuid and room_id=r.id and ready;
  if v.id is null then raise exception 'NOT_FOUND'; end if;
  cid:=(p_payload->>'clientId')::uuid;
  if cid is null or coalesce(length(btrim(p_payload->>'body')),0) not between 1 and 2000 or coalesce(length(btrim(p_payload->>'authorName')),0) not between 1 and 40 or jsonb_typeof(p_payload->'anchor') is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
  select * into c from public.artlink_review_comments where author_id=p_user and client_id=cid;
  if found then if c.room_id<>r.id then raise exception 'INVALID_INPUT'; end if;return to_jsonb(c)-'author_id'; end if;
  if (select count(*) from public.artlink_review_comments where room_id=r.id)>=300 then raise exception 'COMMENT_LIMIT'; end if;
  if (select count(*) from public.artlink_review_comments where author_id=p_user and created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMIT'; end if;
  insert into public.artlink_review_comments(room_id,version_id,author_id,author_name,body,anchor,client_id) values(r.id,v.id,p_user,btrim(p_payload->>'authorName'),btrim(p_payload->>'body'),p_payload->'anchor',cid) returning * into c;
  return to_jsonb(c)-'author_id';
 end if;
 if p_action='remove_comment' then
  delete from public.artlink_review_comments where id=(p_payload->>'commentId')::uuid and room_id=r.id and (author_id=p_user or r.owner_id=p_user);
  if not found then raise exception 'ACCESS_DENIED'; end if;return '{"removed":true}'::jsonb;
 end if;
 if r.owner_id<>p_user then raise exception 'OWNER_REQUIRED'; end if;
 if p_action='begin_delete' then
  insert into public.artlink_review_cleanup(path,after_at) select object_path,now()+interval '3 hours' from public.artlink_review_versions where room_id=r.id and object_path is not null on conflict(path) do update set after_at=excluded.after_at;
  update public.artlink_review_rooms set deleting=true,link_hash=null where id=r.id;return '{"deleting":true}'::jsonb;
 elsif p_action='link' then
  if r.group_id is not null then raise exception 'PRIVATE_ASSIGNMENT'; end if;
  if p_payload->>'newHash' is not null and p_payload->>'newHash' !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
  update public.artlink_review_rooms set link_hash=p_payload->>'newHash' where id=r.id;return '{"updated":true}'::jsonb;
 elsif p_action='resolve' then
  update public.artlink_review_comments set resolved=(p_payload->>'resolved')::boolean where id=(p_payload->>'commentId')::uuid and room_id=r.id;
  if not found then raise exception 'NOT_FOUND'; end if;return '{"updated":true}'::jsonb;
 elsif p_action='reserve' then
  if r.assignment_id is not null and exists(select 1 from public.artlink_group_assignments where id=r.assignment_id and closed_at is not null) then raise exception 'ASSIGNMENT_CLOSED_OR_FIELD'; end if;
  cid:=(p_payload->>'clientId')::uuid;k:=p_payload->>'kind';
  if cid is null or k not in ('text','image','audio','video') then raise exception 'INVALID_INPUT'; end if;
  if (p_payload ? 'reviewRequest' and jsonb_typeof(p_payload->'reviewRequest')<>'string') or (p_payload ? 'changeNote' and jsonb_typeof(p_payload->'changeNote')<>'string') or length(coalesce(p_payload->>'reviewRequest',''))>400 or length(coalesce(p_payload->>'changeNote',''))>600 then raise exception 'INVALID_BRIEF'; end if;
  select * into v from public.artlink_review_versions where room_id=r.id and client_id=cid;
  if found then return to_jsonb(v); end if;
  if (select count(*) from public.artlink_review_versions where room_id=r.id)>=20 then raise exception 'VERSION_LIMIT'; end if;
  if k='text' and coalesce(length(btrim(p_payload->>'body')),0) not between 1 and 20000 then raise exception 'INVALID_INPUT'; end if;
  if k<>'text' and (coalesce((p_payload->>'bytes')::integer,0) not between 1 and 26214400 or coalesce(p_payload->>'mime','') not in ('image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','video/mp4','video/quicktime','video/webm')) then raise exception 'INVALID_INPUT'; end if;
  if coalesce((select sum(case when not x.ready and x.object_path is not null then 26214400 else x.bytes end) from public.artlink_review_versions x join public.artlink_review_rooms rr on rr.id=x.room_id where rr.owner_id=p_user),0)+(case when k='text' then 0 else 26214400 end)>262144000 then raise exception 'STORAGE_LIMIT'; end if;
  aid:=gen_random_uuid();
  insert into public.artlink_review_versions(id,room_id,client_id,kind,body,review_request,change_note,mime,bytes,object_path,ready) values(aid,r.id,cid,k,case when k='text' then p_payload->>'body' else '' end,btrim(coalesce(p_payload->>'reviewRequest','')),btrim(coalesce(p_payload->>'changeNote','')),case when k<>'text' then p_payload->>'mime' end,case when k<>'text' then (p_payload->>'bytes')::integer else 0 end,case when k<>'text' then p_user::text||'/'||r.id::text||'/'||aid::text end,k='text') returning * into v;
  return to_jsonb(v);
 elsif p_action='finalize' then
  update public.artlink_review_versions set ready=true where id=(p_payload->>'versionId')::uuid and room_id=r.id returning * into v;
  if not found then raise exception 'NOT_FOUND'; end if;return to_jsonb(v)-'object_path';
 elsif p_action='pending' then
  select * into v from public.artlink_review_versions where id=(p_payload->>'versionId')::uuid and room_id=r.id;
  if not found then raise exception 'NOT_FOUND'; end if;return to_jsonb(v);
 elsif p_action='paths' then
  return coalesce((select jsonb_agg(object_path) from public.artlink_review_versions where room_id=r.id and object_path is not null),'[]'::jsonb);
 elsif p_action='delete' then
  delete from public.artlink_review_rooms where id=r.id;return '{"removed":true}'::jsonb;
 end if;
 raise exception 'INVALID_ACTION';
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end;$$;
revoke all on function public.artlink_review_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.artlink_review_action(uuid,text,uuid,jsonb) to service_role;
-- Private bucket: direct client insert/select has no policies. All transfers
-- use short-lived server-authorized signed URLs; never overwrite an object.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('review-media','review-media',false,26214400,array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','video/mp4','video/quicktime','video/webm']);
notify pgrst, 'reload schema';
commit;
