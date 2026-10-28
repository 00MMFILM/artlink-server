begin;
alter table public.artlink_group_assignments add column field text not null default 'acting' check(field in ('acting','music','art','dance','literature','film'));
alter table public.artlink_groups drop constraint artlink_groups_kind_check;
alter table public.artlink_groups add constraint artlink_groups_kind_check check(kind in ('academy','theatre','band','dance','art','writing','film','collective'));
create or replace function public.artlink_assignment_action(p_action text, p_group_id uuid, p_payload jsonb default '{}'::jsonb)
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
    if coalesce(p_payload->>'field','acting') not in ('acting','music','art','dance','literature','film') then raise exception 'GROUP_INVALID_INPUT'; end if;
    v_title := btrim(p_payload->>'title'); v_body := btrim(p_payload->>'instructions');
    if v_client is null or coalesce(length(v_title),0) not between 1 and 120 or coalesce(length(v_body),0) not between 1 and 4000 then raise exception 'GROUP_INVALID_INPUT'; end if;
    select * into v_assignment from public.artlink_group_assignments where group_id=p_group_id and client_id=v_client;
    if found then return to_jsonb(v_assignment); end if;
    if (select count(*) from public.artlink_group_assignments where group_id=p_group_id)>=100 then raise exception 'GROUP_ASSIGNMENT_LIMIT'; end if;
    if coalesce(p_payload->>'dueDate','')<>'' then
      if (p_payload->>'dueDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'GROUP_INVALID_INPUT'; end if;
      v_due := (p_payload->>'dueDate')::date;
    end if;
    insert into public.artlink_group_assignments(group_id,title,instructions,due_date,client_id,field)
      values(p_group_id,v_title,v_body,v_due,v_client,coalesce(p_payload->>'field','acting')) returning * into v_assignment;
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
create or replace function public.artlink_group_action(p_action text, p_group_id uuid default null, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_group public.artlink_groups%rowtype;
  v_member public.artlink_group_members%rowtype;
  v_entry public.artlink_group_entries%rowtype;
  v_id uuid;
  v_code text;
  v_name text;
  v_body text;
  v_kind text;
  v_title text;
  v_result jsonb;
begin
  if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'GROUP_LOGIN_REQUIRED' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'GROUP_INVALID_INPUT'; end if;
  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('role',case when g.owner_id=v_user then 'owner' else 'member' end) order by g.created_at desc),'[]'::jsonb)
      into v_result from public.artlink_groups g join public.artlink_group_members m on m.group_id=g.id
      where m.user_id=v_user and m.removed_at is null;
    return v_result;
  elsif p_action = 'create' then
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
    if (select count(*) from public.artlink_groups where owner_id=v_user) >= 3 then raise exception 'GROUP_LIMIT'; end if;
    v_name := btrim(p_payload->>'name');
    v_kind := p_payload->>'kind';
    if v_name is null or length(v_name) not between 1 and 60 or v_kind is null or v_kind not in ('academy','theatre','band','dance','art','writing','film','collective') then raise exception 'GROUP_INVALID_INPUT'; end if;
    if coalesce(length(btrim(p_payload->>'displayName')),0) not between 1 and 40 then raise exception 'GROUP_INVALID_INPUT'; end if;
    insert into public.artlink_groups(owner_id,name,kind) values(v_user,v_name,v_kind) returning * into v_group;
    insert into public.artlink_group_members(group_id,user_id,display_name) values(v_group.id,v_user,btrim(p_payload->>'displayName'));
    return to_jsonb(v_group) || jsonb_build_object('role','owner');
  elsif p_action = 'join' then
    v_code := lower(btrim(p_payload->>'code'));
    if v_code is null or v_code !~ '^[0-9a-f]{32}$' then raise exception 'GROUP_INVITE_INVALID'; end if;
    select group_id into v_id from public.artlink_group_invites where code_hash=sha256(convert_to(v_code,'UTF8')) and expires_at>now();
    if v_id is null then raise exception 'GROUP_INVITE_INVALID'; end if;
    select * into v_group from public.artlink_groups where id=v_id for update;
    -- Recheck after taking the same lock used by invitation rotation/removal.
    if not exists(select 1 from public.artlink_group_invites where group_id=v_id and code_hash=sha256(convert_to(v_code,'UTF8')) and expires_at>now()) then raise exception 'GROUP_INVITE_INVALID'; end if;
    if exists(select 1 from public.artlink_group_members where group_id=v_id and user_id=v_user and removed_at is not null) then raise exception 'GROUP_ACCESS_DENIED' using errcode='42501'; end if;
    if coalesce(length(btrim(p_payload->>'displayName')),0) not between 1 and 40 then raise exception 'GROUP_INVALID_INPUT'; end if;
    insert into public.artlink_group_members(group_id,user_id,display_name) values(v_id,v_user,btrim(p_payload->>'displayName')) on conflict(group_id,user_id) do nothing;
    return to_jsonb(v_group) || jsonb_build_object('role',case when v_group.owner_id=v_user then 'owner' else 'member' end);
  end if;

  -- Serialize writes with membership changes. Read is also checked on every poll.
  select * into v_group from public.artlink_groups where id=p_group_id for update;
  select * into v_member from public.artlink_group_members where group_id=p_group_id and user_id=v_user and removed_at is null;
  if v_group.id is null or v_member.user_id is null then raise exception 'GROUP_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action = 'read' then
    return jsonb_build_object(
      'group',to_jsonb(v_group),'role',case when v_group.owner_id=v_user then 'owner' else 'member' end,
      'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'role',case when m.user_id=v_group.owner_id then 'owner' else 'member' end) order by m.joined_at),'[]'::jsonb) from public.artlink_group_members m where m.group_id=p_group_id and m.removed_at is null),
      'notices',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) from (select * from public.artlink_group_entries where group_id=p_group_id and kind='notice' order by created_at desc,id desc limit 30) e),
      'messages',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb) from (select * from public.artlink_group_entries where group_id=p_group_id and kind='message' order by created_at desc,id desc limit 100) e)
    );
  elsif p_action = 'invite' then
    if v_group.owner_id<>v_user then raise exception 'GROUP_OWNER_REQUIRED' using errcode='42501'; end if;
    v_code := replace(gen_random_uuid()::text,'-','');
    insert into public.artlink_group_invites(group_id,code_hash,expires_at) values(p_group_id,sha256(convert_to(v_code,'UTF8')),now()+interval '7 days')
      on conflict(group_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at;
    return jsonb_build_object('code',v_code,'expires_at',now()+interval '7 days');
  elsif p_action = 'post' then
    v_kind := p_payload->>'kind'; v_body := btrim(p_payload->>'body'); v_title := btrim(coalesce(p_payload->>'title',''));
    if v_kind is null or v_kind not in ('message','notice') or v_body is null or length(v_body) not between 1 and 4000 or length(v_title)>120 then raise exception 'GROUP_INVALID_INPUT'; end if;
    if v_kind='notice' and v_group.owner_id<>v_user then raise exception 'GROUP_OWNER_REQUIRED' using errcode='42501'; end if;
    if v_kind='notice' and v_title='' then raise exception 'GROUP_INVALID_INPUT'; end if;
    v_id := (p_payload->>'clientId')::uuid;
    if v_id is null then raise exception 'GROUP_INVALID_INPUT'; end if;
    select * into v_entry from public.artlink_group_entries where group_id=p_group_id and author_id=v_user and client_id=v_id;
    if v_entry.id is not null then return to_jsonb(v_entry); end if;
    if (select count(*) from public.artlink_group_entries where author_id=v_user and group_id=p_group_id and created_at>now()-interval '1 minute') >= 30 then raise exception 'GROUP_RATE_LIMIT'; end if;
    insert into public.artlink_group_entries(group_id,author_id,author_name,kind,title,body,client_id) values(p_group_id,v_user,v_member.display_name,v_kind,v_title,v_body,v_id) returning * into v_entry;
    return to_jsonb(v_entry);
  elsif p_action = 'delete_entry' then
    v_id := (p_payload->>'entryId')::uuid;
    delete from public.artlink_group_entries where id=v_id and group_id=p_group_id and (author_id=v_user or v_group.owner_id=v_user);
    if not found then raise exception 'GROUP_ACCESS_DENIED' using errcode='42501'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action = 'remove_member' then
    if v_group.owner_id<>v_user then raise exception 'GROUP_OWNER_REQUIRED' using errcode='42501'; end if;
    v_id := (p_payload->>'userId')::uuid;
    if v_id=v_user then raise exception 'GROUP_OWNER_CANNOT_LEAVE'; end if;
    update public.artlink_group_members set removed_at=now() where group_id=p_group_id and user_id=v_id and removed_at is null;
    if not found then raise exception 'GROUP_ACCESS_DENIED' using errcode='42501'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action = 'leave' then
    if v_group.owner_id=v_user then raise exception 'GROUP_OWNER_CANNOT_LEAVE'; end if;
    delete from public.artlink_group_members where group_id=p_group_id and user_id=v_user;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'GROUP_INVALID_ACTION';
end;
$$;

notify pgrst, 'reload schema';
commit;
