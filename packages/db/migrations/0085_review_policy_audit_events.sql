-- Tenant-scoped, append-only audit history for organization/team/repository review policies.
--
-- Policy governance spans installations, so this intentionally does not reuse the installation-
-- scoped audit_events table. Policy rows may later be deleted; policy_id therefore remains a
-- durable subject identifier rather than a foreign key back to review_policies.

create table if not exists review_policy_audit_events (
  id text primary key default gen_random_uuid()::text,
  tenant_id text not null,
  policy_id text not null,
  action text not null,
  scope text not null,
  scope_id text,
  actor_github_user_id bigint not null,
  actor_login text not null,
  before_policy jsonb,
  after_policy jsonb,
  created_at timestamptz not null default now(),
  constraint review_policy_audit_events_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint review_policy_audit_events_tenant_valid
    check (tenant_id = btrim(tenant_id) and char_length(tenant_id) between 1 and 256),
  constraint review_policy_audit_events_policy_valid
    check (policy_id = btrim(policy_id) and char_length(policy_id) between 1 and 256),
  constraint review_policy_audit_events_action_valid
    check (action in ('create', 'update', 'delete')),
  constraint review_policy_audit_events_scope_valid
    check (scope in ('organization', 'team', 'repository')),
  constraint review_policy_audit_events_scope_id_valid
    check (scope_id is null or (scope_id = btrim(scope_id) and char_length(scope_id) between 1 and 256)),
  constraint review_policy_audit_events_actor_id_valid
    check (actor_github_user_id > 0),
  constraint review_policy_audit_events_actor_login_valid
    check (actor_login = btrim(actor_login) and char_length(actor_login) between 1 and 256),
  constraint review_policy_audit_events_before_valid
    check (
      before_policy is null
      or (jsonb_typeof(before_policy) = 'object' and pg_column_size(before_policy) <= 65536)
    ),
  constraint review_policy_audit_events_after_valid
    check (
      after_policy is null
      or (jsonb_typeof(after_policy) = 'object' and pg_column_size(after_policy) <= 65536)
    ),
  constraint review_policy_audit_events_snapshot_shape_valid
    check (
      (action = 'create' and before_policy is null and after_policy is not null)
      or (action = 'update' and before_policy is not null and after_policy is not null)
      or (action = 'delete' and before_policy is not null and after_policy is null)
    )
);

create or replace function boardreadyops_reject_review_policy_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'review_policy_audit_events is append-only'
    using errcode = '55000';
end;
$$;

drop trigger if exists review_policy_audit_events_append_only on review_policy_audit_events;
create trigger review_policy_audit_events_append_only
  before update or delete on review_policy_audit_events
  for each row execute function boardreadyops_reject_review_policy_audit_event_mutation();

create index if not exists review_policy_audit_events_tenant_created_idx
  on review_policy_audit_events(tenant_id, created_at desc, id desc);

create index if not exists review_policy_audit_events_policy_created_idx
  on review_policy_audit_events(tenant_id, policy_id, created_at desc, id desc);

insert into cloud_schema_migrations (version)
values ('0085_review_policy_audit_events')
on conflict (version) do nothing;
