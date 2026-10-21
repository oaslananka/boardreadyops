-- Non-executable, immutable identity seals for a future branch-only release
-- execution contract. A seal is not a dispatch authorization. Existing
-- release_runs, outbox, runner leases and OIDC callbacks must NOT interpret it
-- as a permission to run. Every seal reserves one run/attempt identity.
create table if not exists protected_release_execution_seals (
  id text primary key default gen_random_uuid()::text,
  candidate_id text not null references protected_release_intent_candidates(id) on delete cascade,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  github_repository_id bigint not null,
  actor_github_user_id bigint not null,
  ref text not null,
  commit_sha text not null,
  evidence_digest text not null,
  run_id text not null,
  execution_attempt_id text not null,
  snapshot_version integer not null default 1,
  snapshot_digest text not null,
  sealed_at timestamptz not null,
  dispatch_allowed boolean not null default false,
  constraint protected_release_seals_candidate_unique unique (candidate_id),
  constraint protected_release_seals_run_unique unique (run_id),
  constraint protected_release_seals_attempt_unique unique (execution_attempt_id),
  constraint protected_release_seals_version_valid check (snapshot_version = 1),
  constraint protected_release_seals_non_executable check (dispatch_allowed = false),
  constraint protected_release_seals_github_repository_valid check (github_repository_id > 0),
  constraint protected_release_seals_actor_valid check (actor_github_user_id > 0),
  constraint protected_release_seals_ref_valid
    check (ref like 'refs/heads/%' and char_length(ref) between 12 and 255),
  constraint protected_release_seals_sha_valid check (commit_sha ~ '^[0-9a-f]{40}$'),
  constraint protected_release_seals_evidence_valid check (evidence_digest ~ '^[0-9a-f]{64}$'),
  constraint protected_release_seals_snapshot_valid check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  constraint protected_release_seals_run_uuid check
    (run_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint protected_release_seals_attempt_uuid check
    (execution_attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);

create index if not exists protected_release_seals_repository_idx
  on protected_release_execution_seals(repository_id, sealed_at desc, id desc);

create or replace function boardreadyops_reject_protected_release_seal_update()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'protected release execution seals cannot be updated' using errcode = '55000';
end;
$$;

drop trigger if exists protected_release_seals_immutable on protected_release_execution_seals;
create trigger protected_release_seals_immutable
  before update on protected_release_execution_seals
  for each row execute function boardreadyops_reject_protected_release_seal_update();

-- Security-invoker: the caller must have separately authenticated the GitHub
-- viewer and observed live admin/branch HEAD/effective rules. This seal makes
-- no external GitHub or durable workflow authority claim: fresh verification
-- is still required immediately before a future separately designed enqueue.
create or replace function boardreadyops_seal_protected_release_identity(
  p_candidate_id text,
  p_installation_id text,
  p_repository_id text,
  p_github_installation_id bigint,
  p_github_repository_id bigint,
  p_actor_github_user_id bigint,
  p_run_id text,
  p_attempt_id text,
  p_now timestamptz
)
returns table(seal_id text, seal_digest text, inserted boolean)
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_candidate protected_release_intent_candidates%rowtype;
  v_existing protected_release_execution_seals%rowtype;
  v_digest text;
  v_server_now timestamptz := clock_timestamp();
begin
  if p_now is null
     or p_now > v_server_now + interval '30 seconds'
     or p_now < v_server_now - interval '30 seconds'
     or p_run_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_attempt_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_run_id = p_attempt_id then
    raise exception 'invalid protected release execution seal identities' using errcode = '22023';
  end if;

  select candidate.* into v_candidate
    from public.protected_release_intent_candidates as candidate
    join public.repositories as repository
      on repository.id = candidate.repository_id
     and repository.installation_id = candidate.installation_id
    join public.installations as installation
      on installation.id = repository.installation_id
   where candidate.id = p_candidate_id
     and candidate.installation_id = p_installation_id
     and candidate.repository_id = p_repository_id
     and candidate.github_repository_id = p_github_repository_id
     and candidate.actor_github_user_id = p_actor_github_user_id
     and installation.github_installation_id = p_github_installation_id
     and repository.github_repo_id = p_github_repository_id
     and repository.default_branch = substring(candidate.ref from 12)
     and repository.private = false
     and repository.disabled_at is null
     and installation.suspended_at is null
   for share of candidate, repository, installation;

  if v_candidate.id is null
     or v_candidate.observed_at > v_server_now + interval '5 seconds'
     or v_candidate.observed_at < v_server_now - interval '2 minutes' then
    raise exception 'stale or mismatched protected release evidence'
      using errcode = '22023';
  end if;

  v_digest := encode(digest(jsonb_build_object(
    'version', 1, 'candidateId', v_candidate.id,
    'installationId', p_installation_id, 'repositoryId', p_repository_id,
    'githubInstallationId', p_github_installation_id,
    'githubRepositoryId', p_github_repository_id,
    'actorGitHubUserId', p_actor_github_user_id,
    'ref', v_candidate.ref, 'commitSha', v_candidate.commit_sha,
    'evidenceDigest', v_candidate.evidence_digest,
    'runId', p_run_id, 'executionAttemptId', p_attempt_id
  )::text, 'sha256'), 'hex');

  insert into public.protected_release_execution_seals (
    candidate_id, installation_id, repository_id, github_repository_id,
    actor_github_user_id, ref, commit_sha, evidence_digest,
    run_id, execution_attempt_id, snapshot_version, snapshot_digest, sealed_at
  ) values (
    v_candidate.id, p_installation_id, p_repository_id, p_github_repository_id,
    p_actor_github_user_id, v_candidate.ref, v_candidate.commit_sha,
    v_candidate.evidence_digest, p_run_id, p_attempt_id, 1, v_digest, p_now
  )
  on conflict (candidate_id) do nothing
  returning * into v_existing;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.snapshot_digest, true;
    return;
  end if;

  select * into v_existing
    from public.protected_release_execution_seals
   where candidate_id = p_candidate_id
   for share;

  if v_existing.id is null
     or v_existing.installation_id is distinct from p_installation_id
     or v_existing.repository_id is distinct from p_repository_id
     or v_existing.github_repository_id is distinct from p_github_repository_id
     or v_existing.actor_github_user_id is distinct from p_actor_github_user_id
     or v_existing.run_id is distinct from p_run_id
     or v_existing.execution_attempt_id is distinct from p_attempt_id
     or v_existing.ref is distinct from v_candidate.ref
     or v_existing.commit_sha is distinct from v_candidate.commit_sha
     or v_existing.evidence_digest is distinct from v_candidate.evidence_digest
     or v_existing.snapshot_version <> 1
     or v_existing.snapshot_digest is distinct from v_digest then
    raise exception 'protected release seal conflicts with existing immutable identity'
      using errcode = '23505';
  end if;

  return query select v_existing.id, v_existing.snapshot_digest, false;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0089_protected_release_execution_seals')
on conflict (version) do nothing;
