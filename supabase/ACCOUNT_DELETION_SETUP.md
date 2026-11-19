# StudyFlow account deletion setup

This is a manual deployment checklist. The migration has not been run and the
functions have not been deployed. Do not enable the cleanup schedule until the
live schema, policies, foreign keys, Storage buckets, and other user-owned
resources have been reviewed.

## 1. Inspect the live project first

Run these read-only queries in the Supabase SQL editor and review the results:

```sql
-- Relevant columns and database types.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'tasks', 'subjects')
order by table_name, ordinal_position;

-- Existing RLS enablement and policy definitions.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       p.policyname, p.permissive, p.cmd, p.roles, p.qual, p.with_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname in ('profiles', 'tasks', 'subjects')
order by c.relname, p.policyname;

-- Direct FK dependencies touching Auth users, profiles, tasks, and subjects.
select conrelid::regclass as source_table,
       a.attname as source_column,
       confrelid::regclass as target_table,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
where c.contype = 'f'
  and (
    c.conrelid in (
      'auth.users'::regclass,
      'public.profiles'::regclass,
      'public.tasks'::regclass,
      'public.subjects'::regclass
    )
    or c.confrelid in (
      'auth.users'::regclass,
      'public.profiles'::regclass,
      'public.tasks'::regclass,
      'public.subjects'::regclass
    )
  )
order by 1, 2;

-- User-owned tables outside the three tables this repository uses.
select table_name
from information_schema.columns
where table_schema = 'public'
  and column_name in ('user_id', 'owner_id', 'profile_id')
group by table_name
order by table_name;

-- Storage buckets and object counts. Inspect object names/ownership conventions
-- before deciding whether there are user-specific files to remove.
select b.id as bucket_id, b.name as bucket_name, count(o.id) as object_count
from storage.buckets b
left join storage.objects o on o.bucket_id = b.id
group by b.id, b.name
order by b.name;

-- Preserve and inspect existing scheduled jobs; do not replace unrelated jobs.
select extname
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault');

select jobid, jobname, schedule, command, active
from cron.job
order by jobid;

-- Check migration object-name collisions before applying the migration.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'studyflow_account_deletion_20261118'
       and p.proname = 'account_is_active')
   or (n.nspname = 'public'
       and p.proname in (
         'studyflow_account_deletion_claim_20261118',
         'studyflow_account_deletion_restore_20261118'
       ))
order by 1, 2;

select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
from pg_policies
where policyname = 'studyflow_account_deletion_gate_20261118'
   or tablename = 'studyflow_account_deletion_queue_20261118'
order by schemaname, tablename, policyname;
```

The checked-in browser project contains no Storage API calls, no other
user-owned tables, no migration history, and no existing Cron/function source.
That repository inspection cannot prove what exists in the hosted project.
The foreign-key query lists direct dependencies. Follow dependencies of any
additional discovered user-owned tables as well. The user-owned-column query
is only a heuristic; inspect project-specific ownership conventions too.
The `cron.job` query can only be run if `pg_cron` is installed (check the
extension query first). The cleanup Edge Function fails closed until
`ACCOUNT_STORAGE_AUDIT_CONFIRMED=true` is set after the live audit. If any
user-owned Storage objects or other tables exist, add their secure cleanup to
the function before setting that flag.

## 2. Apply and review the migration

Review and manually run
`supabase/migrations/202611180001_account_deletion.sql` only after checking
the live query results. It adds `profiles.deletion_requested_at`, a
server-only claimed-deletion retry queue, atomic claim/restore RPCs, and
restrictive active-account gates on profiles/tasks/subjects. The migration
uses versioned object names and does not drop or replace existing permissive
owner policies. It deliberately fails if its versioned private schema already
exists; inspect such a collision rather than reusing or revoking an unrelated
schema.

The claim and restore RPCs both lock the profile row with `SELECT ... FOR
UPDATE`. The cleanup RPC checks the deadline using database time and inserts
the durable claimed queue record in the same transaction. Restore takes the
same row lock and refuses to clear a request if the claim exists or the
deadline has passed. Whichever transaction commits first determines the
outcome. Cleanup only deletes account data after the claim RPC reports
`claimed`.

The queue has RLS enabled, no client policies, and explicit table revokes from
`PUBLIC`, `anon`, and `authenticated`; only `service_role` gets table
privileges. Claim/restore RPC execution is also revoked from those client
roles and granted only to `service_role`. The active-account RLS helper is
separate: authenticated users need schema usage and execute permission for
policy evaluation, but it returns only their own active/inactive boolean.

## 3. Deploy Edge Functions and secrets

Deploy `account-lifecycle` and `cleanup-accounts` from this repository using
the Supabase CLI linked to the intended project. The included
`supabase/config.toml` requires JWT verification for the authenticated
lifecycle function; the cleanup function verifies its own high-entropy
scheduled-call token.

Configure these values as **Edge Function secrets** in Supabase Dashboard
(Edge Functions → Secrets), never in this repository or frontend:

- `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role key, server-side only.
- `ACCOUNT_CLEANUP_TOKEN`: a newly generated high-entropy random token.
- `ACCOUNT_STORAGE_AUDIT_CONFIRMED`: set to the literal `true` only after the
  Storage and additional-table audit is complete and all discovered resources
  have cleanup code.

The account lifecycle function also uses the Supabase-provided
`SUPABASE_URL` and `SUPABASE_ANON_KEY` server environment values. The service
role key must never be placed in SQL, HTML, JavaScript, Git, or public config.

## 4. Configure the scheduled call

In Supabase Dashboard, enable the `pg_cron`, `pg_net`, and `Vault`
extensions (Database → Extensions). Store the project URL and the same cleanup
token in Vault. The token itself is not included here; use the value set as
`ACCOUNT_CLEANUP_TOKEN` above.

```sql
select vault.create_secret(
  'https://xxoszflwsvmawivpylzb.supabase.co',
  'studyflow_project_url'
);

-- Replace the string below with the generated cleanup token. Do not put a
-- service-role key here.
select vault.create_secret(
  'REPLACE_WITH_THE_RANDOM_ACCOUNT_CLEANUP_TOKEN',
  'studyflow_account_cleanup_token'
);

select cron.schedule(
  'studyflow-account-deletion-cleanup',
  '17 * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'studyflow_project_url'
      ) || '/functions/v1/cleanup-accounts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-studyflow-cleanup-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'studyflow_account_cleanup_token'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
```

Use a unique job name so the existing task-archive cleanup, if present, remains
untouched. After enabling, inspect `cron.job`, `cron.job_run_details`, and
Edge Function logs. Verify one authenticated test account only after the
30-day eligibility logic and data cleanup have been reviewed. Do not regard
cleanup as active until a scheduled invocation and its result are verified.

Vault keeps secrets out of the scheduled SQL text; still limit access to
database job/history views because `pg_net` queues outbound requests.

## Lifecycle behavior

- Authenticated status/request/restore calls identify the user from a validated
  Supabase JWT; request and restore payloads never provide a user ID.
- Scheduling requires a recently issued password-authentication AMR claim.
  Unsupported OAuth-only users receive a clear response instead of bypassing
  reauthentication.
- Pending accounts are denied normal profiles/tasks/subjects access by the
  restrictive RLS gate. They retain their Auth identity and all rows during the
  30-day recovery period.
- Once claimed, the pending screen explicitly says permanent deletion has
  started and disables Restore Account. If Auth deletion fails after the
  profile has been removed, the queue lets status still identify the account
  as claimed and non-restorable.
- Cleanup rechecks the database deadline in the claim transaction, then
  deletes tasks before subjects and profile, and calls Supabase Auth Admin.
  It deletes the claim only after Auth deletion succeeds. Any prior failure
  leaves the claim for another scheduled run; repeating row deletes and the
  Auth deletion handles already-removed resources. Storage cleanup must be
  added if the live audit finds account-owned objects.
