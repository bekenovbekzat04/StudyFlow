-- Keep the subject identity attached to a task while it is in Recently Deleted.
alter table public.tasks
  add column if not exists deleted_subject_name text,
  add column if not exists deleted_subject_color text;

-- Backfill archived tasks that still retain their subject foreign key. Existing
-- non-null snapshots are preserved so rerunning this migration is safe.
update public.tasks as task
   set deleted_subject_name = coalesce(task.deleted_subject_name, subject.name),
       deleted_subject_color = coalesce(task.deleted_subject_color, subject.color::text)
  from public.subjects as subject
 where task.deleted_at is not null
   and task.subject_id = subject.id
   and task.user_id = subject.user_id
   and (task.deleted_subject_name is null or task.deleted_subject_color is null);

create or replace function public.studyflow_snapshot_task_subject_20261119()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_subject_name text;
  v_subject_color text;
begin
  if old.deleted_at is null
     and new.deleted_at is not null
     and new.subject_id is not null then
    select subject.name, subject.color::text
      into v_subject_name, v_subject_color
      from public.subjects as subject
     where subject.id = new.subject_id
       and subject.user_id = new.user_id;

    if found then
      -- Keep a valid prior snapshot; never replace it with a later subject edit.
      new.deleted_subject_name := coalesce(new.deleted_subject_name, v_subject_name);
      new.deleted_subject_color := coalesce(new.deleted_subject_color, v_subject_color);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists studyflow_snapshot_task_subject_20261119 on public.tasks;
create trigger studyflow_snapshot_task_subject_20261119
before update of deleted_at on public.tasks
for each row
execute function public.studyflow_snapshot_task_subject_20261119();

-- Trigger function EXECUTE permission is checked when the trigger is created;
-- the trigger itself continues to run as the updating user under RLS.
revoke all on function public.studyflow_snapshot_task_subject_20261119()
  from public, anon, authenticated;

-- Restore all requested archive rows in one transaction. SECURITY INVOKER keeps
-- the caller's table grants and RLS policies in force for every read and write.
create or replace function public.studyflow_restore_archived_tasks_20261119(
  p_task_ids uuid[],
  p_completed boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_task public.tasks%rowtype;
  v_subject public.subjects%rowtype;
  v_subject_id uuid;
  v_lock_name text;
  v_recreated_count integer := 0;
  v_restored_count integer := 0;
  v_requested_count integer;
  v_distinct_count integer;
  v_rows jsonb := '[]'::jsonb;
  v_subjects jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to restore tasks.'
      using errcode = '42501';
  end if;

  if p_task_ids is null then
    raise exception 'A task ID array is required.'
      using errcode = '22023';
  end if;

  if p_completed is null then
    raise exception 'The completed flag cannot be null.'
      using errcode = '22023';
  end if;

  if cardinality(p_task_ids) = 0 then
    return jsonb_build_object(
      'tasks', v_rows,
      'recreated_subjects', 0,
      'subjects', v_subjects
    );
  end if;

  -- Null and duplicate IDs are rejected before any task or subject is changed.
  select count(*)::integer, count(distinct supplied.task_id)::integer
    into v_requested_count, v_distinct_count
    from unnest(p_task_ids) as supplied(task_id);

  if v_requested_count <> cardinality(p_task_ids)
     or v_distinct_count <> v_requested_count then
    raise exception 'Task selection contains null or duplicate IDs.'
      using errcode = '22023';
  end if;

  -- Take subject-name locks in a stable order before locking task rows. This
  -- serializes concurrent restores of the same owner's normalized subject name
  -- without introducing inconsistent lock ordering between bulk requests.
  for v_lock_name in
    select distinct lower(normalize(btrim(task.deleted_subject_name), NFKC))
      from public.tasks as task
     where task.id = any(p_task_ids)
       and task.user_id = auth.uid()
       and task.deleted_at is not null
       and nullif(btrim(task.deleted_subject_name), '') is not null
     order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtext(auth.uid()::text),
      hashtext(v_lock_name)
    );
  end loop;

  for v_task in
    select task.*
      from public.tasks as task
     where task.id = any(p_task_ids)
       and task.user_id = auth.uid()
       and task.deleted_at is not null
     order by task.id
     for update
  loop
    v_subject_id := null;
    v_subject := null;

    -- A referenced subject is reusable only if it is visible to and owned by
    -- the authenticated caller. If it is missing/inaccessible, use the archive
    -- snapshot below instead of retaining a foreign or stale subject ID.
    if v_task.subject_id is not null then
      select subject.*
        into v_subject
        from public.subjects as subject
       where subject.id = v_task.subject_id
         and subject.user_id = auth.uid();
      if found then
        v_subject_id := v_subject.id;
      end if;
    end if;

    if v_subject_id is null
       and nullif(btrim(v_task.deleted_subject_name), '') is not null then
      v_lock_name := lower(normalize(btrim(v_task.deleted_subject_name), NFKC));

      select subject.*
        into v_subject
        from public.subjects as subject
       where subject.user_id = auth.uid()
         and lower(normalize(btrim(subject.name), NFKC)) = v_lock_name
       order by subject.id
       limit 1
       for update;

      if found then
        v_subject_id := v_subject.id;
      else
        insert into public.subjects (user_id, name, color)
        values (
          auth.uid(),
          btrim(v_task.deleted_subject_name),
          coalesce(v_task.deleted_subject_color, '#7564e8')
        )
        returning * into v_subject;

        v_subject_id := v_subject.id;
        v_recreated_count := v_recreated_count + 1;
      end if;
    end if;

    -- A task that had no subject and no snapshot intentionally remains
    -- unassigned. Only return subjects owned by this authenticated user.
    if v_subject_id is not null then
      if not (v_subjects @> jsonb_build_array(jsonb_build_object('id', v_subject.id))) then
        v_subjects := v_subjects || jsonb_build_array(jsonb_build_object(
          'id', v_subject.id,
          'user_id', v_subject.user_id,
          'name', v_subject.name,
          'color', v_subject.color
        ));
      end if;
    end if;

    update public.tasks as task
       set subject_id = v_subject_id,
           status = case when p_completed then 'completed' else task.status end,
           deleted_at = null,
           deleted_subject_name = null,
           deleted_subject_color = null
     where task.id = v_task.id
       and task.user_id = auth.uid()
       and task.deleted_at is not null
    returning task.* into v_task;

    if not found then
      raise exception 'An archived task changed before it could be restored.'
        using errcode = '40001';
    end if;

    v_rows := v_rows || jsonb_build_array(to_jsonb(v_task));
    v_restored_count := v_restored_count + 1;
  end loop;

  -- Missing, already-restored, or RLS-inaccessible IDs make the whole call
  -- fail. Raising here rolls back subject inserts and task updates from the loop.
  if v_restored_count <> v_requested_count then
    raise exception 'One or more archived tasks were not found or are not available.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'tasks', v_rows,
    'recreated_subjects', v_recreated_count,
    'subjects', v_subjects
  );
end;
$$;

revoke all on function public.studyflow_restore_archived_tasks_20261119(uuid[], boolean)
  from public, anon;
grant execute on function public.studyflow_restore_archived_tasks_20261119(uuid[], boolean)
  to authenticated;
