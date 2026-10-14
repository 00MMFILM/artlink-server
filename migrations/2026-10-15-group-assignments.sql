-- Apply after 2026-10-11-private-groups.sql. Private submissions are visible
-- only to their author and the current group owner. No local media is uploaded.
begin;
create table public.artlink_group_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.artlink_groups(id) on delete cascade,
  title text not null check(length(title) between 1 and 120),
  instructions text not null check(length(instructions) between 1 and 4000),
  due_date date,
  closed_at timestamptz,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  unique(group_id,client_id), unique(id,group_id)
);
create table public.artlink_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  group_id uuid not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  note_key text not null check(length(note_key) between 1 and 128),
  note_title text not null check(length(note_title) between 1 and 120),
  practice_text text not null default '' check(length(practice_text)<=12000),
  ai_feedback text not null default '' check(length(ai_feedback)<=20000),
  reflection text not null default '' check(length(reflection)<=2000),
  previous_id uuid references public.artlink_assignment_submissions(id) on delete set null,
  teacher_comment text not null default '' check(length(teacher_comment)<=4000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key(assignment_id,group_id) references public.artlink_group_assignments(id,group_id) on delete cascade,
  unique(assignment_id,author_id,client_id), unique(assignment_id,author_id,note_key),
  check(length(btrim(practice_text))>0 or length(btrim(ai_feedback))>0)
);
create index artlink_assignments_recent on public.artlink_group_assignments(group_id,created_at desc);
create index artlink_submissions_recent on public.artlink_assignment_submissions(assignment_id,author_id,created_at desc);
alter table public.artlink_group_assignments enable row level security;
alter table public.artlink_assignment_submissions enable row level security;
revoke all on public.artlink_group_assignments,public.artlink_assignment_submissions from public,anon,authenticated;

create function public.artlink_assignment_action(p_action text, p_group_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_group public.artlink_groups%rowtype;
  v_member public.artlink_group_members%rowtype;
  v_assignment public.artlink_group_assignments%rowtype;
  v_submission public.artlink_assignment_submissions%rowtype;
  v_id uuid;
  v_client uuid;
  v_previous uuid;
  v_due date;
  v_title text;
  v_body text;
  v_feedback text;
  v_reflection text;
  v_note_key text;
begin
  if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'GROUP_LOGIN_REQUIRED' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'GROUP_INVALID_INPUT'; end if;
  -- Same lock as membership revocation, so an excluded member cannot submit
  -- after revocation commits. Serializes idempotency and attempt chaining too.
  select * into v_group from public.artlink_groups where id=p_group_id for update;
  select * into v_member from public.artlink_group_members where group_id=p_group_id and user_id=v_user and removed_at is null;
  if v_group.id is null or v_member.user_id is null then raise exception 'GROUP_ACCESS_DENIED' using errcode='42501'; end if;

  if p_action='list' then
    return jsonb_build_object('role',case when v_group.owner_id=v_user then 'owner' else 'member' end,
      'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]'::jsonb) from
        (select * from public.artlink_group_assignments where group_id=p_group_id order by created_at desc,id desc limit 100) a),
      'metrics',case when v_group.owner_id=v_user then jsonb_build_object(
        'members',(select count(*) from public.artlink_group_members where group_id=p_group_id and user_id<>v_user and removed_at is null),
        'submitters',(select count(distinct author_id) from public.artlink_assignment_submissions where group_id=p_group_id),
        'submissions',(select count(*) from public.artlink_assignment_submissions where group_id=p_group_id),
        'feedbackShared',(select count(*) from public.artlink_assignment_submissions where group_id=p_group_id and ai_feedback<>''),
        'reviewed',(select count(*) from public.artlink_assignment_submissions where group_id=p_group_id and reviewed_at is not null),
        'repeaters',(select count(distinct author_id) from public.artlink_assignment_submissions where group_id=p_group_id and previous_id is not null),
        'repeatersWithin7Days',(select count(distinct s.author_id) from public.artlink_assignment_submissions s
          where s.group_id=p_group_id and s.previous_id is not null and s.created_at <=
          (select min(f.created_at) from public.artlink_assignment_submissions f where f.assignment_id=s.assignment_id and f.author_id=s.author_id)+interval '7 days')
      ) else null end);
  elsif p_action='create' then
    if v_group.owner_id<>v_user then raise exception 'GROUP_OWNER_REQUIRED' using errcode='42501'; end if;
    v_client := (p_payload->>'clientId')::uuid;
    v_title := btrim(p_payload->>'title'); v_body := btrim(p_payload->>'instructions');
    if v_client is null or coalesce(length(v_title),0) not between 1 and 120 or coalesce(length(v_body),0) not between 1 and 4000 then raise exception 'GROUP_INVALID_INPUT'; end if;
    select * into v_assignment from public.artlink_group_assignments where group_id=p_group_id and client_id=v_client;
    if found then return to_jsonb(v_assignment); end if;
    if (select count(*) from public.artlink_group_assignments where group_id=p_group_id)>=100 then raise exception 'GROUP_ASSIGNMENT_LIMIT'; end if;
    if coalesce(p_payload->>'dueDate','')<>'' then
      if (p_payload->>'dueDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'GROUP_INVALID_INPUT'; end if;
      v_due := (p_payload->>'dueDate')::date;
    end if;
    insert into public.artlink_group_assignments(group_id,title,instructions,due_date,client_id)
      values(p_group_id,v_title,v_body,v_due,v_client) returning * into v_assignment;
    return to_jsonb(v_assignment);
  end if;

  v_id := (p_payload->>'assignmentId')::uuid;
  select * into v_assignment from public.artlink_group_assignments where id=v_id and group_id=p_group_id;
  if v_assignment.id is null then raise exception 'GROUP_ASSIGNMENT_NOT_FOUND'; end if;
  if p_action='read' then
    return jsonb_build_object('assignment',to_jsonb(v_assignment),'role',case when v_group.owner_id=v_user then 'owner' else 'member' end,
      'submissions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc),'[]'::jsonb) from
        (select * from public.artlink_assignment_submissions where assignment_id=v_id and (author_id=v_user or v_group.owner_id=v_user) order by created_at desc,id desc limit 200) s));
  elsif p_action='close' then
    if v_group.owner_id<>v_user then raise exception 'GROUP_OWNER_REQUIRED' using errcode='42501'; end if;
    update public.artlink_group_assignments set closed_at=coalesce(closed_at,now()) where id=v_id returning * into v_assignment;
    return to_jsonb(v_assignment);
  elsif p_action='submit' then
    if v_group.owner_id=v_user then raise exception 'GROUP_STUDENT_REQUIRED'; end if;
    v_client := (p_payload->>'clientId')::uuid;
    if v_client is null then raise exception 'GROUP_INVALID_INPUT'; end if;
    select * into v_submission from public.artlink_assignment_submissions where assignment_id=v_id and author_id=v_user and client_id=v_client;
    if found then return to_jsonb(v_submission); end if;
    if v_assignment.closed_at is not null then raise exception 'GROUP_ASSIGNMENT_CLOSED'; end if;
    if p_payload->'consent' is distinct from 'true'::jsonb then raise exception 'GROUP_SUBMISSION_CONSENT'; end if;
    v_note_key := btrim(p_payload->>'noteKey'); v_title := btrim(p_payload->>'noteTitle');
    v_body := btrim(coalesce(p_payload->>'practiceText','')); v_feedback := btrim(coalesce(p_payload->>'aiFeedback','')); v_reflection := btrim(coalesce(p_payload->>'reflection',''));
    if coalesce(length(v_note_key),0) not between 1 and 128 or coalesce(length(v_title),0) not between 1 and 120 or length(v_body)>12000 or length(v_feedback)>20000 or length(v_reflection)>2000 or (v_body='' and v_feedback='') then raise exception 'GROUP_INVALID_INPUT'; end if;
    if exists(select 1 from public.artlink_assignment_submissions where assignment_id=v_id and author_id=v_user and note_key=v_note_key) then raise exception 'GROUP_NOTE_ALREADY_SUBMITTED'; end if;
    if (select count(*) from public.artlink_assignment_submissions where assignment_id=v_id and author_id=v_user)>=20 then raise exception 'GROUP_SUBMISSION_LIMIT'; end if;
    select id into v_previous from public.artlink_assignment_submissions where assignment_id=v_id and author_id=v_user order by created_at desc,id desc limit 1;
    insert into public.artlink_assignment_submissions(assignment_id,group_id,author_id,author_name,note_key,note_title,practice_text,ai_feedback,reflection,previous_id,client_id)
      values(v_id,p_group_id,v_user,v_member.display_name,v_note_key,v_title,v_body,v_feedback,v_reflection,v_previous,v_client) returning * into v_submission;
    return to_jsonb(v_submission);
  elsif p_action='review' then
    if v_group.owner_id<>v_user then raise exception 'GROUP_OWNER_REQUIRED' using errcode='42501'; end if;
    v_body := btrim(p_payload->>'comment');
    if coalesce(length(v_body),0) not between 1 and 4000 then raise exception 'GROUP_INVALID_INPUT'; end if;
    update public.artlink_assignment_submissions set teacher_comment=v_body,reviewed_by=v_user,reviewed_at=now()
      where id=(p_payload->>'submissionId')::uuid and assignment_id=v_id returning * into v_submission;
    if not found then raise exception 'GROUP_ACCESS_DENIED' using errcode='42501'; end if;
    return to_jsonb(v_submission);
  end if;
  raise exception 'GROUP_INVALID_ACTION';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  raise exception 'GROUP_INVALID_INPUT';
end;
$$;
revoke all on function public.artlink_assignment_action(text,uuid,jsonb) from public,anon;
grant execute on function public.artlink_assignment_action(text,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
