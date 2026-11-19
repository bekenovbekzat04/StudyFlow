-- Manual migration draft. Review the live schema, RLS policies, helper/schema
-- names, and foreign keys before running. This file has not been executed.

alter table public.profiles
  add column if not exists deletion_requested_at timestamptz null;
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.subjects enable row level security;

create index if not exists studyflow_account_deletion_requested_at_20261118_idx
  on public.profiles (deletion_requested_at)
  where deletion_requested_at is not null;

-- The queue is also the irreversible cleanup claim. It has no FK so it
-- survives profile/Auth removal and can retry after any partial failure.
create table public.studyflow_account_deletion_queue_20261118 (
  user_id uuid primary key,
  deletion_requested_at timestamptz not null,
  claimed_at timestamptz not null,
  queued_at timestamptz not null default clock_timestamp()
);
alter table public.studyflow_account_deletion_queue_20261118 enable row level security;
revoke all on table public.studyflow_account_deletion_queue_20261118
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.studyflow_account_deletion_queue_20261118 to service_role;

-- A dedicated, versioned schema avoids changing grants or objects in a generic
-- existing private schema. CREATE (without IF NOT EXISTS) intentionally fails
-- on a collision so an operator can inspect it before proceeding.
create schema studyflow_account_deletion_20261118;
revoke all on schema studyflow_account_deletion_20261118
  from public, anon, authenticated;
grant usage on schema studyflow_account_deletion_20261118 to authenticated;

create function studyflow_account_deletion_20261118.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (
    not exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
    )
    and not exists (
      select 1 from public.studyflow_account_deletion_queue_20261118 q
      where q.user_id = (select auth.uid())
    )
  ) or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.deletion_requested_at is null
      and not exists (
        select 1 from public.studyflow_account_deletion_queue_20261118 q
        where q.user_id = (select auth.uid())
      )
  );
$function$;
revoke all on function studyflow_account_deletion_20261118.account_is_active()
  from public, anon;
grant execute on function studyflow_account_deletion_20261118.account_is_active()
  to authenticated;

-- This SECURITY DEFINER RPC serializes the irreversible claim with restore by
-- locking the profile row. Its caller is restricted to the server-side role.
create function public.studyflow_account_deletion_claim_20261118(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_claim public.studyflow_account_deletion_queue_20261118%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    select * into v_claim
    from public.studyflow_account_deletion_queue_20261118
    where user_id = p_user_id
    for update;
    if found then
      return jsonb_build_object(
        'status', 'claimed',
        'requestedAt', v_claim.deletion_requested_at,
        'deletionDeadline', v_claim.deletion_requested_at + interval '30 days'
      );
    end if;
    return jsonb_build_object('status', 'not_pending');
  end if;

  if v_profile.deletion_requested_at is null then
    return jsonb_build_object('status', 'not_pending');
  end if;
  if v_profile.deletion_requested_at > v_now - interval '30 days' then
    return jsonb_build_object(
      'status', 'not_due',
      'requestedAt', v_profile.deletion_requested_at,
      'deletionDeadline', v_profile.deletion_requested_at + interval '30 days'
    );
  end if;

  select * into v_claim
  from public.studyflow_account_deletion_queue_20261118
  where user_id = p_user_id
  for update;
  if found then
    if v_claim.deletion_requested_at = v_profile.deletion_requested_at then
      return jsonb_build_object(
        'status', 'claimed',
        'requestedAt', v_claim.deletion_requested_at,
        'deletionDeadline', v_claim.deletion_requested_at + interval '30 days'
      );
    end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  insert into public.studyflow_account_deletion_queue_20261118
    (user_id, deletion_requested_at, claimed_at)
  values (p_user_id, v_profile.deletion_requested_at, v_now);

  return jsonb_build_object(
    'status', 'claimed',
    'requestedAt', v_profile.deletion_requested_at,
    'deletionDeadline', v_profile.deletion_requested_at + interval '30 days'
  );
end;
$function$;
revoke all on function public.studyflow_account_deletion_claim_20261118(uuid)
  from public, anon, authenticated;
grant execute on function public.studyflow_account_deletion_claim_20261118(uuid)
  to service_role;

-- Restore takes the same profile-row lock as claim. It is idempotent for an
-- already-restored profile, but never clears a claimed or expired request.
create function public.studyflow_account_deletion_restore_20261118(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_claim public.studyflow_account_deletion_queue_20261118%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    select * into v_claim
    from public.studyflow_account_deletion_queue_20261118
    where user_id = p_user_id
    for update;
    if found then
      return jsonb_build_object(
        'status', 'claimed',
        'requestedAt', v_claim.deletion_requested_at,
        'deletionDeadline', v_claim.deletion_requested_at + interval '30 days'
      );
    end if;
    return jsonb_build_object('status', 'not_pending');
  end if;

  select * into v_claim
  from public.studyflow_account_deletion_queue_20261118
  where user_id = p_user_id
  for update;
  if found then
    return jsonb_build_object(
      'status', 'claimed',
      'requestedAt', v_claim.deletion_requested_at,
      'deletionDeadline', v_claim.deletion_requested_at + interval '30 days'
    );
  end if;

  if v_profile.deletion_requested_at is null then
    return jsonb_build_object('status', 'restored', 'profile', to_jsonb(v_profile));
  end if;
  if v_profile.deletion_requested_at <= v_now - interval '30 days' then
    return jsonb_build_object(
      'status', 'expired',
      'requestedAt', v_profile.deletion_requested_at,
      'deletionDeadline', v_profile.deletion_requested_at + interval '30 days'
    );
  end if;

  update public.profiles
  set deletion_requested_at = null
  where id = p_user_id
  returning * into v_profile;
  return jsonb_build_object('status', 'restored', 'profile', to_jsonb(v_profile));
end;
$function$;
revoke all on function public.studyflow_account_deletion_restore_20261118(uuid)
  from public, anon, authenticated;
grant execute on function public.studyflow_account_deletion_restore_20261118(uuid)
  to service_role;

-- Unique policy names; no existing permissive owner policies are dropped or
-- replaced. Restrictive policies AND with them.
create policy studyflow_account_deletion_gate_20261118 on public.profiles
  as restrictive for all to authenticated
  using (studyflow_account_deletion_20261118.account_is_active())
  with check (studyflow_account_deletion_20261118.account_is_active());

create policy studyflow_account_deletion_gate_20261118 on public.tasks
  as restrictive for all to authenticated
  using (studyflow_account_deletion_20261118.account_is_active())
  with check (studyflow_account_deletion_20261118.account_is_active());

create policy studyflow_account_deletion_gate_20261118 on public.subjects
  as restrictive for all to authenticated
  using (studyflow_account_deletion_20261118.account_is_active())
  with check (studyflow_account_deletion_20261118.account_is_active());

comment on column public.profiles.deletion_requested_at is
  'Account deletion request time; cleanup can claim after 30 days.';
