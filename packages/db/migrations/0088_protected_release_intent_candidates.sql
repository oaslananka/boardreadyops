-- Evidence-only, append-only candidate records for future protected-branch runs.
-- IMPORTANT: Nothing in this migration creates a release_run, dispatch, lease,
-- OIDC authority, or permission to execute code. A separate authorized path
-- must check fresh GitHub branch/rules/admin evidence and persist a full immutable
-- execution trust snapshot before protected dispatch can ever be enabled.
--
-- Keep this record separate from PR-scoped release_runs: their enqueue,
-- supersession and check-run outbox contracts key on pull_request_number.
--
-- Repository uninstall/retention cascades may remove these records; ordinary
-- updates cannot rewrite the historical candidate.

create table if not exists protected_release_intent_candidates (
  id text primary key default gen_random_uuid()::text,
  installation_id text not null references installations(id) on delete cascade,
  repository_id text not null references repositories(id) on delete cascade,
  github_repository_id bigint not null,
  actor_github_user_id bigint not null,
  actor_login text not null,
  ref text not null,
  commit_sha text not null,
  request_id text not null,
  evidence_version integer not null default 1,
  evidence_digest text not null,
  observed_at timestamptz not null,
  constraint protected_release_intent_github_repository_id_valid check (github_repository_id > 0),
  constraint protected_release_intent_actor_id_valid check (actor_github_user_id > 0),
  constraint protected_release_intent_actor_login_valid
    check (actor_login ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  constraint protected_release_intent_commit_sha_valid
    check (commit_sha ~ '^[0-9a-f]{40}$'),
  constraint protected_release_intent_request_id_valid
    check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint protected_release_intent_evidence_version_valid check (evidence_version = 1),
  constraint protected_release_intent_digest_valid
    check (evidence_digest ~ '^[0-9a-f]{64}$'),
  constraint protected_release_intent_ref_valid
    check (ref like 'refs/heads/%' and char_length(ref) between 12 and 255),
  constraint protected_release_intent_unique_request
    unique (installation_id, repository_id, request_id)
);

create index if not exists protected_release_intent_repository_observed_idx
  on protected_release_intent_candidates(repository_id, observed_at desc, id desc);

create or replace function boardreadyops_reject_protected_release_intent_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'protected release intent candidates cannot be updated'
    using errcode = '55000';
end;
$$;

drop trigger if exists protected_release_intent_immutable on protected_release_intent_candidates;
create trigger protected_release_intent_immutable
  before update on protected_release_intent_candidates
  for each row execute function boardreadyops_reject_protected_release_intent_update();

-- The caller must be an authenticated server-side flow which has independently
-- verified the GitHub session actor and repository admin permission. This
-- security-invoker function is a durable evidence recorder, NOT an authorization
-- grant and NOT a protected-release enqueue. All identifiers are re-bound to
-- the current database installation and repository under row locks.
create or replace function boardreadyops_record_protected_release_intent_candidate(
  p_installation_id text,
  p_repository_id text,
  p_github_installation_id bigint,
  p_github_repository_id bigint,
  p_actor_github_user_id bigint,
  p_actor_login text,
  p_ref text,
  p_commit_sha text,
  p_request_id text,
  p_evidence_digest text,
  p_now timestamptz
)
returns table(candidate_id text, inserted boolean)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_default_branch text;
  v_candidate protected_release_intent_candidates%rowtype;
begin
  if p_actor_github_user_id is null or p_actor_github_user_id <= 0
     or p_actor_login !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or p_now is null then
    raise exception 'invalid protected release evidence candidate'
      using errcode = '22023';
  end if;

  select repository.default_branch
    into v_default_branch
    from public.repositories as repository
    join public.installations as installation
      on installation.id = repository.installation_id
   where repository.id = p_repository_id
     and installation.id = p_installation_id
     and repository.github_repo_id = p_github_repository_id
     and installation.github_installation_id = p_github_installation_id
     and repository.disabled_at is null
     and repository.private = false
     and installation.suspended_at is null
   for share of repository, installation;

  if v_default_branch is null or p_ref is distinct from 'refs/heads/' || v_default_branch then
    raise exception 'protected release repository/ref binding rejected'
      using errcode = '22023';
  end if;

  insert into public.protected_release_intent_candidates (
    installation_id, repository_id, github_repository_id,
    actor_github_user_id, actor_login, ref, commit_sha, request_id,
    evidence_version, evidence_digest, observed_at
  ) values (
    p_installation_id, p_repository_id, p_github_repository_id,
    p_actor_github_user_id, p_actor_login, p_ref, p_commit_sha, p_request_id,
    1, p_evidence_digest, p_now
  )
  on conflict (installation_id, repository_id, request_id) do nothing
  returning * into v_candidate;

  if v_candidate.id is not null then
    return query select v_candidate.id, true;
    return;
  end if;

  select *
    into v_candidate
    from public.protected_release_intent_candidates
   where installation_id = p_installation_id
     and repository_id = p_repository_id
     and request_id = p_request_id
   for share;

  if v_candidate.id is null
     or v_candidate.github_repository_id is distinct from p_github_repository_id
     or v_candidate.actor_github_user_id is distinct from p_actor_github_user_id
     or v_candidate.actor_login is distinct from p_actor_login
     or v_candidate.ref is distinct from p_ref
     or v_candidate.commit_sha is distinct from p_commit_sha
     or v_candidate.evidence_version <> 1
     or v_candidate.evidence_digest is distinct from p_evidence_digest then
    raise exception 'protected release request id reused with different evidence'
      using errcode = '23505';
  end if;

  return query select v_candidate.id, false;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0088_protected_release_intent_candidates')
on conflict (version) do nothing;
