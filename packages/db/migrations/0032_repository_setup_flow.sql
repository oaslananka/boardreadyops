-- Versioned repository setup, workflow/config readiness probes, and run provenance.

create table if not exists repository_setup_revisions (
  id text primary key,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  revision integer not null,
  preset text not null,
  preset_version integer not null,
  source text not null,
  actor_id text not null,
  request_id text not null,
  workflow_path text not null default 'readiness-runner.yml',
  workflow_contract_version integer,
  workflow_status text not null,
  config_status text not null,
  config_version integer,
  observed_sha text,
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint repository_setup_revision_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint repository_setup_revision_positive check (revision > 0),
  constraint repository_setup_preset_valid
    check (preset in ('open-source', 'prototype', 'production', 'contract-design')),
  constraint repository_setup_preset_version_valid check (preset_version > 0),
  constraint repository_setup_source_valid check (source in ('operator', 'workflow_probe')),
  constraint repository_setup_actor_valid
    check (actor_id = btrim(actor_id) and char_length(actor_id) between 1 and 128),
  constraint repository_setup_request_valid
    check (request_id = btrim(request_id) and char_length(request_id) between 1 and 128),
  constraint repository_setup_workflow_path_valid
    check (workflow_path = 'readiness-runner.yml'),
  constraint repository_setup_workflow_contract_valid
    check (workflow_contract_version is null or workflow_contract_version > 0),
  constraint repository_setup_workflow_status_valid
    check (workflow_status in ('unknown', 'missing', 'disabled', 'actions_disabled', 'incompatible', 'ready')),
  constraint repository_setup_config_status_valid
    check (config_status in ('unknown', 'missing', 'invalid', 'ready')),
  constraint repository_setup_config_version_valid check (config_version is null or config_version > 0),
  constraint repository_setup_observed_sha_valid
    check (observed_sha is null or observed_sha ~ '^[0-9a-f]{40}$'),
  constraint repository_setup_diagnostics_valid
    check (jsonb_typeof(diagnostics) = 'array' and pg_column_size(diagnostics) <= 32768),
  unique (repository_id, revision),
  unique (installation_id, request_id)
);

alter table repositories
  add column if not exists current_setup_revision_id text;

alter table repositories
  drop constraint if exists repositories_current_setup_revision_fk;
alter table repositories
  add constraint repositories_current_setup_revision_fk
  foreign key (current_setup_revision_id)
  references repository_setup_revisions(id)
  on delete set null;

alter table release_runs
  add column if not exists repository_setup_revision_id text
  references repository_setup_revisions(id)
  on delete set null;

create index if not exists repository_setup_revisions_scope_idx
  on repository_setup_revisions(installation_id, repository_id, revision desc);
create index if not exists release_runs_setup_revision_idx
  on release_runs(repository_setup_revision_id)
  where repository_setup_revision_id is not null;

create table if not exists repository_setup_probes (
  id text primary key,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  setup_revision_id text not null references repository_setup_revisions(id) on delete cascade,
  result_revision_id text references repository_setup_revisions(id) on delete set null,
  requested_by text not null,
  request_id text not null,
  status text not null default 'pending',
  workflow_run_id text,
  failure_code text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint repository_setup_probe_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint repository_setup_probe_requester_valid
    check (requested_by = btrim(requested_by) and char_length(requested_by) between 1 and 128),
  constraint repository_setup_probe_request_valid
    check (request_id = btrim(request_id) and char_length(request_id) between 1 and 128),
  constraint repository_setup_probe_status_valid
    check (status in ('pending', 'dispatched', 'completed', 'failed', 'expired')),
  constraint repository_setup_probe_workflow_run_valid
    check (workflow_run_id is null or workflow_run_id ~ '^[1-9][0-9]{0,19}$'),
  constraint repository_setup_probe_failure_valid
    check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint repository_setup_probe_deadline_valid check (expires_at > created_at),
  unique (installation_id, request_id)
);

create index if not exists repository_setup_probes_pending_idx
  on repository_setup_probes(status, expires_at, id)
  where status in ('pending', 'dispatched');

create or replace function boardreadyops_validate_repository_setup_scope()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from repositories
     where repositories.id = new.repository_id
       and repositories.installation_id = new.installation_id
  ) then
    raise exception 'repository setup repository does not belong to installation'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function boardreadyops_validate_repository_setup_probe_scope()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from repository_setup_revisions
     where repository_setup_revisions.id = new.setup_revision_id
       and repository_setup_revisions.repository_id = new.repository_id
       and repository_setup_revisions.installation_id = new.installation_id
  ) then
    raise exception 'repository setup probe revision does not belong to repository'
      using errcode = '23514';
  end if;
  if new.result_revision_id is not null and not exists (
    select 1 from repository_setup_revisions
     where repository_setup_revisions.id = new.result_revision_id
       and repository_setup_revisions.repository_id = new.repository_id
       and repository_setup_revisions.installation_id = new.installation_id
  ) then
    raise exception 'repository setup probe result does not belong to repository'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function boardreadyops_reject_repository_setup_revision_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'repository_setup_revisions is append-only' using errcode = '55000';
end;
$$;

drop trigger if exists repository_setup_revisions_validate_scope on repository_setup_revisions;
create trigger repository_setup_revisions_validate_scope
  before insert on repository_setup_revisions
  for each row execute function boardreadyops_validate_repository_setup_scope();

drop trigger if exists repository_setup_revisions_append_only on repository_setup_revisions;
create trigger repository_setup_revisions_append_only
  before update or delete on repository_setup_revisions
  for each row execute function boardreadyops_reject_repository_setup_revision_mutation();

drop trigger if exists repository_setup_probes_validate_scope on repository_setup_probes;
create trigger repository_setup_probes_validate_scope
  before insert or update of installation_id, repository_id, setup_revision_id, result_revision_id
  on repository_setup_probes
  for each row execute function boardreadyops_validate_repository_setup_probe_scope();

create or replace function boardreadyops_apply_repository_setup_revision(
  p_id text,
  p_installation_id text,
  p_repository_id text,
  p_preset text,
  p_preset_version integer,
  p_source text,
  p_actor_id text,
  p_request_id text,
  p_workflow_status text,
  p_workflow_contract_version integer,
  p_config_status text,
  p_config_version integer,
  p_observed_sha text,
  p_diagnostics jsonb,
  p_now timestamptz
)
returns table(outcome text, revision_id text, revision integer)
language plpgsql
security invoker
as $$
declare
  v_existing repository_setup_revisions%rowtype;
  v_revision integer;
begin
  select * into v_existing
    from repository_setup_revisions
   where installation_id = p_installation_id
     and request_id = p_request_id;
  if found then
    if v_existing.repository_id <> p_repository_id
      or v_existing.preset <> p_preset
      or v_existing.preset_version <> p_preset_version
      or v_existing.source <> p_source
      or v_existing.workflow_status <> p_workflow_status
      or v_existing.workflow_contract_version is distinct from p_workflow_contract_version
      or v_existing.config_status <> p_config_status
      or v_existing.config_version is distinct from p_config_version
      or v_existing.observed_sha is distinct from p_observed_sha then
      return query select 'conflict'::text, v_existing.id, v_existing.revision;
      return;
    end if;
    return query select 'replayed'::text, v_existing.id, v_existing.revision;
    return;
  end if;

  perform 1 from repositories
   where id = p_repository_id and installation_id = p_installation_id
   for update;
  if not found then
    return query select 'not_found'::text, null::text, null::integer;
    return;
  end if;

  select coalesce(max(repository_setup_revisions.revision), 0) + 1
    into v_revision
    from repository_setup_revisions
   where repository_id = p_repository_id;

  insert into repository_setup_revisions (
    id, installation_id, repository_id, revision, preset, preset_version,
    source, actor_id, request_id, workflow_path, workflow_contract_version,
    workflow_status, config_status, config_version, observed_sha, diagnostics, created_at
  ) values (
    p_id, p_installation_id, p_repository_id, v_revision, p_preset, p_preset_version,
    p_source, p_actor_id, p_request_id, 'readiness-runner.yml', p_workflow_contract_version,
    p_workflow_status, p_config_status, p_config_version, p_observed_sha,
    coalesce(p_diagnostics, '[]'::jsonb), p_now
  );

  update repositories
     set current_setup_revision_id = p_id
   where id = p_repository_id and installation_id = p_installation_id;

  insert into audit_events (
    id, installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, request_id, metadata, created_at
  ) values (
    gen_random_uuid()::text, p_installation_id,
    case when p_source = 'workflow_probe'
      then 'github_app.repository.setup_validated'
      else 'github_app.repository.setup_changed' end,
    case when p_source = 'workflow_probe' then 'github_actions' else 'operator' end,
    p_actor_id, 'repository_setup', p_id, p_repository_id, p_request_id,
    jsonb_build_object(
      'preset', p_preset,
      'presetVersion', p_preset_version,
      'setupRevision', v_revision,
      'workflowStatus', p_workflow_status,
      'configStatus', p_config_status
    ) || case when p_workflow_contract_version is null then '{}'::jsonb
              else jsonb_build_object('workflowContractVersion', p_workflow_contract_version) end
      || case when p_config_version is null then '{}'::jsonb
              else jsonb_build_object('configVersion', p_config_version) end,
    p_now
  );

  return query select 'applied'::text, p_id, v_revision;
end;
$$;

create or replace function boardreadyops_create_repository_setup_probe(
  p_id text,
  p_installation_id text,
  p_repository_id text,
  p_requested_by text,
  p_request_id text,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns table(outcome text, probe_id text, setup_revision_id text)
language plpgsql
security invoker
as $$
declare
  v_existing repository_setup_probes%rowtype;
  v_setup_revision_id text;
begin
  select * into v_existing
    from repository_setup_probes
   where installation_id = p_installation_id and request_id = p_request_id;
  if found then
    if v_existing.repository_id <> p_repository_id or v_existing.requested_by <> p_requested_by then
      return query select 'conflict'::text, v_existing.id, v_existing.setup_revision_id;
    else
      return query select 'replayed'::text, v_existing.id, v_existing.setup_revision_id;
    end if;
    return;
  end if;

  select current_setup_revision_id into v_setup_revision_id
    from repositories
   where id = p_repository_id and installation_id = p_installation_id
   for update;
  if v_setup_revision_id is null then
    return query select 'not_configured'::text, null::text, null::text;
    return;
  end if;

  insert into repository_setup_probes (
    id, installation_id, repository_id, setup_revision_id,
    requested_by, request_id, status, expires_at, created_at
  ) values (
    p_id, p_installation_id, p_repository_id, v_setup_revision_id,
    p_requested_by, p_request_id, 'pending', p_expires_at, p_now
  );

  insert into audit_events (
    id, installation_id, event_type, actor_type, actor_id,
    subject_type, subject_id, repository_id, request_id, metadata, created_at
  ) values (
    gen_random_uuid()::text, p_installation_id, 'github_app.repository.setup_probe_requested',
    'operator', p_requested_by, 'repository_setup_probe', p_id,
    p_repository_id, p_request_id,
    jsonb_build_object('probeId', p_id), p_now
  );

  return query select 'created'::text, p_id, v_setup_revision_id;
end;
$$;

create or replace function boardreadyops_mark_repository_setup_probe_dispatched(
  p_probe_id text,
  p_workflow_run_id text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
declare
  v_probe repository_setup_probes%rowtype;
begin
  select * into v_probe from repository_setup_probes where id = p_probe_id for update;
  if not found then return 'not_found'; end if;
  if v_probe.status = 'dispatched' and v_probe.workflow_run_id = p_workflow_run_id then return 'replayed'; end if;
  if v_probe.status <> 'pending' then return 'stale'; end if;
  if v_probe.expires_at <= p_now then
    update repository_setup_probes set status = 'expired', completed_at = p_now where id = p_probe_id;
    return 'expired';
  end if;
  update repository_setup_probes
     set status = 'dispatched', workflow_run_id = p_workflow_run_id
   where id = p_probe_id;
  return 'applied';
end;
$$;

create or replace function boardreadyops_fail_repository_setup_probe(
  p_probe_id text,
  p_failure_code text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
begin
  update repository_setup_probes
     set status = 'failed', failure_code = p_failure_code, completed_at = p_now
   where id = p_probe_id and status in ('pending', 'dispatched');
  if found then return 'applied'; end if;
  return case when exists(select 1 from repository_setup_probes where id = p_probe_id)
    then 'stale' else 'not_found' end;
end;
$$;

create or replace function boardreadyops_complete_repository_setup_probe(
  p_probe_id text,
  p_result_revision_id text,
  p_workflow_contract_version integer,
  p_config_status text,
  p_config_version integer,
  p_observed_sha text,
  p_diagnostics jsonb,
  p_now timestamptz
)
returns table(outcome text, revision_id text, revision integer)
language plpgsql
security invoker
as $$
declare
  v_probe repository_setup_probes%rowtype;
  v_setup repository_setup_revisions%rowtype;
  v_apply record;
  v_workflow_status text;
begin
  select * into v_probe from repository_setup_probes where id = p_probe_id for update;
  if not found then return query select 'not_found'::text, null::text, null::integer; return; end if;
  if v_probe.status = 'completed' then
    select id, repository_setup_revisions.revision into v_apply
      from repository_setup_revisions where id = v_probe.result_revision_id;
    return query select 'replayed'::text, v_probe.result_revision_id, v_apply.revision;
    return;
  end if;
  if v_probe.status = 'expired' then
    return query select 'expired'::text, null::text, null::integer;
    return;
  end if;
  if v_probe.status not in ('pending', 'dispatched') then
    return query select 'stale'::text, null::text, null::integer; return;
  end if;
  if v_probe.expires_at <= p_now then
    update repository_setup_probes set status = 'expired', completed_at = p_now where id = p_probe_id;
    return query select 'expired'::text, null::text, null::integer; return;
  end if;

  select * into v_setup from repository_setup_revisions where id = v_probe.setup_revision_id;
  if not found then raise exception 'repository setup probe source revision is missing' using errcode = '23503'; end if;
  v_workflow_status := case when p_workflow_contract_version = 1 then 'ready' else 'incompatible' end;

  select * into v_apply
    from boardreadyops_apply_repository_setup_revision(
      p_result_revision_id, v_probe.installation_id, v_probe.repository_id,
      v_setup.preset, v_setup.preset_version, 'workflow_probe', 'github-actions',
      'probe-result:' || p_probe_id, v_workflow_status, p_workflow_contract_version,
      p_config_status, p_config_version, p_observed_sha, p_diagnostics, p_now
    );
  if v_apply.outcome not in ('applied', 'replayed') then
    return query select v_apply.outcome, v_apply.revision_id, v_apply.revision; return;
  end if;

  update repository_setup_probes
     set status = 'completed', result_revision_id = v_apply.revision_id, completed_at = p_now
   where id = p_probe_id;
  return query select 'completed'::text, v_apply.revision_id, v_apply.revision;
end;
$$;

-- Snapshot the effective setup revision on every newly enqueued run.
create or replace function boardreadyops_enqueue_release_run_with_outbox(
  p_github_repo_id bigint,
  p_pull_request_number integer,
  p_commit_sha text,
  p_ref text,
  p_trigger_kind text,
  p_github_installation_id bigint,
  p_now timestamptz,
  p_run_id text,
  p_release_idempotency_key text,
  p_outbox_id text,
  p_outbox_payload jsonb
)
returns table(
  run_id text,
  release_idempotency_key text,
  run_status text,
  outbox_id text
)
language plpgsql
security invoker
as $$
declare
  v_repository_id text;
  v_setup_revision_id text;
  v_candidate record;
  v_transition_outcome text;
  v_run_id text;
  v_run_status text;
  v_check_run_id bigint;
  v_outbox_id text;
  v_outbox_idempotency_key text;
  v_outbox_payload jsonb;
begin
  select repositories.id, repositories.current_setup_revision_id
    into v_repository_id, v_setup_revision_id
    from repositories
    join installations on installations.id = repositories.installation_id
   where repositories.github_repo_id = p_github_repo_id
     and installations.github_installation_id = p_github_installation_id
   for key share of repositories;

  if v_repository_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_repository_id || ':' || p_pull_request_number::text, 0)
  );

  for v_candidate in
    select release_runs.id,
           release_runs.status,
           release_runs.version,
           release_runs.execution_attempt_id
      from release_runs
     where release_runs.repository_id = v_repository_id
       and release_runs.pull_request_number = p_pull_request_number
       and release_runs.commit_sha <> p_commit_sha
       and release_runs.status in ('queued', 'dispatched', 'running')
     order by release_runs.started_at, release_runs.id
     for update of release_runs
  loop
    select superseded.transition_outcome
      into v_transition_outcome
      from boardreadyops_supersede_release_run_state(
        v_candidate.id,
        v_candidate.status,
        v_candidate.version,
        v_candidate.execution_attempt_id,
        'newer_commit',
        p_now
      ) as superseded;

    if v_transition_outcome <> 'applied' then
      raise exception 'release-run supersession changed after it was locked'
        using errcode = '40001';
    end if;
  end loop;

  insert into release_runs (
    id,
    repository_id,
    repository_setup_revision_id,
    idempotency_key,
    commit_sha,
    ref,
    pull_request_number,
    trigger_kind,
    status,
    started_at
  ) values (
    p_run_id,
    v_repository_id,
    v_setup_revision_id,
    p_release_idempotency_key,
    p_commit_sha,
    p_ref,
    p_pull_request_number,
    p_trigger_kind,
    'queued',
    p_now
  )
  on conflict (idempotency_key)
  do update set status = release_runs.status
  returning release_runs.id, release_runs.status, release_runs.github_check_run_id
    into v_run_id, v_run_status, v_check_run_id;

  if v_run_id is null then
    return;
  end if;

  v_outbox_idempotency_key := 'github.check_run.create:' || v_run_id;
  v_outbox_payload := jsonb_set(p_outbox_payload, '{runId}', to_jsonb(v_run_id), true);

  if v_check_run_id is null then
    insert into control_plane_outbox (
      id,
      release_run_id,
      effect_type,
      payload_version,
      idempotency_key,
      payload,
      priority,
      status,
      available_at,
      attempt_count,
      max_attempts,
      created_at
    ) values (
      p_outbox_id,
      v_run_id,
      'github.check_run.create',
      1,
      v_outbox_idempotency_key,
      v_outbox_payload,
      50,
      'available',
      p_now,
      0,
      8,
      p_now
    )
    on conflict (idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
    returning control_plane_outbox.id into v_outbox_id;
  else
    select control_plane_outbox.id
      into v_outbox_id
      from control_plane_outbox
     where control_plane_outbox.idempotency_key = v_outbox_idempotency_key;
  end if;

  return query
  select v_run_id, p_release_idempotency_key, v_run_status, v_outbox_id;
end;
$$;
