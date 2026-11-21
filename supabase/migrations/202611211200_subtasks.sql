-- Add optional subtasks without changing existing task data.
create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  is_completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_subtasks_task_position_idx
  on public.task_subtasks(task_id, position);

create or replace function public.studyflow_set_subtask_updated_at_20261121()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists studyflow_set_subtask_updated_at_20261121 on public.task_subtasks;
create trigger studyflow_set_subtask_updated_at_20261121
before update on public.task_subtasks
for each row execute function public.studyflow_set_subtask_updated_at_20261121();

revoke all on function public.studyflow_set_subtask_updated_at_20261121()
  from public, anon, authenticated;

alter table public.task_subtasks enable row level security;

-- Owner policies are kept separate and intentionally require both ownership
-- of the subtask row and ownership of its parent task.
drop policy if exists task_subtasks_owner_select_20261121 on public.task_subtasks;
create policy task_subtasks_owner_select_20261121 on public.task_subtasks
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks task
      where task.id = task_subtasks.task_id
        and task.user_id = auth.uid()
    )
  );

drop policy if exists task_subtasks_owner_insert_20261121 on public.task_subtasks;
create policy task_subtasks_owner_insert_20261121 on public.task_subtasks
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks task
      where task.id = task_subtasks.task_id
        and task.user_id = auth.uid()
    )
  );

drop policy if exists task_subtasks_owner_update_20261121 on public.task_subtasks;
create policy task_subtasks_owner_update_20261121 on public.task_subtasks
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks task
      where task.id = task_subtasks.task_id
        and task.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks task
      where task.id = task_subtasks.task_id
        and task.user_id = auth.uid()
    )
  );

drop policy if exists task_subtasks_owner_delete_20261121 on public.task_subtasks;
create policy task_subtasks_owner_delete_20261121 on public.task_subtasks
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks task
      where task.id = task_subtasks.task_id
        and task.user_id = auth.uid()
    )
  );

-- Preserve the existing 20261118 account-deletion gate exactly as a restrictive
-- policy; it ANDs with the owner policies above and does not weaken them.
do $$
begin
  if to_regprocedure('studyflow_account_deletion_20261118.account_is_active()') is null then
    raise exception 'Required account-deletion gate function 20261118 is missing.'
      using errcode = '42883';
  end if;
end;
$$;

drop policy if exists studyflow_account_deletion_gate_20261118 on public.task_subtasks;
create policy studyflow_account_deletion_gate_20261118 on public.task_subtasks
  as restrictive for all to authenticated
  using (studyflow_account_deletion_20261118.account_is_active())
  with check (studyflow_account_deletion_20261118.account_is_active());

grant select, insert, update, delete on public.task_subtasks to authenticated;

-- Create or replace one parent task and all of its subtasks in one transaction.
create or replace function public.studyflow_save_task_with_subtasks_20261121(
  p_task_id uuid,
  p_subject_id uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_status text,
  p_priority text,
  p_subtasks jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_task public.tasks%rowtype;
  v_subtask jsonb;
  v_subtask_id uuid;
  v_keep_ids uuid[] := '{}';
  v_title text;
  v_completed boolean;
  v_position integer;
  v_rows jsonb := '[]'::jsonb;
  v_seen_ids uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A task title is required.' using errcode = '22023';
  end if;
  if p_status not in ('todo', 'progress', 'completed') then
    raise exception 'Invalid task status.' using errcode = '22023';
  end if;
  if p_priority not in ('Low', 'Medium', 'High') then
    raise exception 'Invalid task priority.' using errcode = '22023';
  end if;
  if p_subtasks is null or jsonb_typeof(p_subtasks) <> 'array' then
    raise exception 'Subtasks must be a JSON array.' using errcode = '22023';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.subjects subject
    where subject.id = p_subject_id
      and subject.user_id = auth.uid()
  ) then
    raise exception 'Subject was not found or you do not have permission to use it.'
      using errcode = 'P0002';
  end if;

  if p_task_id is null then
    insert into public.tasks (
      user_id, subject_id, title, description, due_date, status, priority
    ) values (
      auth.uid(), p_subject_id, btrim(p_title), nullif(btrim(p_description), ''),
      p_due_date, p_status, p_priority
    )
    returning * into v_task;
  else
    update public.tasks
       set subject_id = p_subject_id,
           title = btrim(p_title),
           description = nullif(btrim(p_description), ''),
           due_date = p_due_date,
           status = p_status,
           priority = p_priority
     where id = p_task_id
       and user_id = auth.uid()
       and deleted_at is null
    returning * into v_task;

    if v_task.id is null then
      raise exception 'Task was not found or you do not have permission to edit it.'
        using errcode = 'P0002';
    end if;
  end if;

  v_position := 0;
  for v_subtask in select value from jsonb_array_elements(p_subtasks)
  loop
    v_title := nullif(btrim(coalesce(v_subtask->>'title', '')), '');
    v_completed := coalesce((v_subtask->>'is_completed')::boolean, false);
    if p_status = 'completed' then
      v_completed := true;
    end if;
    v_subtask_id := nullif(v_subtask->>'id', '')::uuid;

    if v_title is null then
      raise exception 'Every subtask must have a title.' using errcode = '22023';
    end if;

    if v_subtask_id is not null then
      if v_subtask_id = any(v_seen_ids) then
        raise exception 'Subtask IDs must not be duplicated.' using errcode = '22023';
      end if;
      update public.task_subtasks
         set title = v_title,
             is_completed = v_completed,
             position = v_position
       where id = v_subtask_id
         and task_id = v_task.id
         and user_id = auth.uid()
      returning id into v_subtask_id;

      if v_subtask_id is null then
        raise exception 'Subtask was not found or you do not have permission to edit it.'
          using errcode = 'P0002';
      end if;
      v_seen_ids := array_append(v_seen_ids, v_subtask_id);
      v_keep_ids := array_append(v_keep_ids, v_subtask_id);
    else
      insert into public.task_subtasks (
        task_id, user_id, title, is_completed, position
      ) values (
        v_task.id, auth.uid(), v_title, v_completed, v_position
      )
      returning id into v_subtask_id;
      v_seen_ids := array_append(v_seen_ids, v_subtask_id);
      v_keep_ids := array_append(v_keep_ids, v_subtask_id);
    end if;
    v_position := v_position + 1;
  end loop;

  delete from public.task_subtasks
   where task_id = v_task.id
     and user_id = auth.uid()
     and not (id = any(v_keep_ids));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', subtask.id,
      'title', subtask.title,
      'is_completed', subtask.is_completed,
      'position', subtask.position,
      'created_at', subtask.created_at,
      'updated_at', subtask.updated_at
    ) order by subtask.position, subtask.created_at
  ), '[]'::jsonb)
    into v_rows
    from public.task_subtasks subtask
   where subtask.task_id = v_task.id
     and subtask.user_id = auth.uid();

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id,
      'user_id', v_task.user_id,
      'subject_id', v_task.subject_id,
      'title', v_task.title,
      'description', v_task.description,
      'due_date', v_task.due_date,
      'status', v_task.status,
      'priority', v_task.priority,
      'created_at', v_task.created_at,
      'deleted_at', v_task.deleted_at,
      'deleted_subject_name', v_task.deleted_subject_name,
      'deleted_subject_color', v_task.deleted_subject_color,
      'task_subtasks', v_rows
    ),
    'subtasks', v_rows
  );
end;
$$;

revoke all on function public.studyflow_save_task_with_subtasks_20261121(uuid,uuid,text,text,date,text,text,jsonb)
  from public, anon;
grant execute on function public.studyflow_save_task_with_subtasks_20261121(uuid,uuid,text,text,date,text,text,jsonb)
  to authenticated;

-- Complete selected parents and every subtask atomically, but only for owned tasks.
create or replace function public.studyflow_complete_tasks_with_subtasks_20261121(
  p_task_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_task public.tasks%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_requested_count integer;
  v_distinct_count integer;
  v_found_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_task_ids is null or cardinality(p_task_ids) = 0 then
    return '[]'::jsonb;
  end if;
  select count(*), count(distinct supplied.task_id)
    into v_requested_count, v_distinct_count
    from unnest(p_task_ids) as supplied(task_id);
  if v_requested_count <> v_distinct_count then
    raise exception 'Task selection contains duplicate IDs.' using errcode = '22023';
  end if;
  select count(*)
    into v_found_count
    from public.tasks
   where id = any(p_task_ids)
     and user_id = auth.uid()
     and deleted_at is null;
  if v_found_count <> cardinality(p_task_ids) then
    raise exception 'One or more tasks were not found or are not available.'
      using errcode = 'P0002';
  end if;

  for v_task in
    select task.*
      from public.tasks task
     where task.id = any(p_task_ids)
       and task.user_id = auth.uid()
       and task.deleted_at is null
     order by task.id
     for update
  loop
    update public.tasks
       set status = 'completed'
     where id = v_task.id
       and user_id = auth.uid()
       and deleted_at is null
    returning * into v_task;

    update public.task_subtasks
       set is_completed = true
     where task_id = v_task.id
       and user_id = auth.uid();

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_task.id,
      'user_id', v_task.user_id,
      'subject_id', v_task.subject_id,
      'title', v_task.title,
      'description', v_task.description,
      'due_date', v_task.due_date,
      'status', v_task.status,
      'priority', v_task.priority,
      'created_at', v_task.created_at,
      'deleted_at', v_task.deleted_at,
      'deleted_subject_name', v_task.deleted_subject_name,
      'deleted_subject_color', v_task.deleted_subject_color
    ));
  end loop;

  return v_rows;
end;
$$;

revoke all on function public.studyflow_complete_tasks_with_subtasks_20261121(uuid[])
  from public, anon;
grant execute on function public.studyflow_complete_tasks_with_subtasks_20261121(uuid[])
  to authenticated;
