-- Additive owner-identity evidence v2. Old v1 evidence stays immutable and
-- cannot be silently converted into v2. Neither version authorizes execution:
-- the caller must still implement separate fresh verified authority, atomic
-- branch-only enqueue, dispatch/lease, OIDC and callback checks.
alter table protected_release_intent_candidates
  add column if not exists github_owner_id bigint;

alter table protected_release_intent_candidates
  drop constraint if exists protected_release_intent_evidence_version_valid,
  add constraint protected_release_intent_evidence_version_valid check (
    (evidence_version = 1 and github_owner_id is null)
    or (evidence_version = 2 and github_owner_id > 0)
  );

-- Dedicated v2 writer keeps the legacy v1 signature and old data unchanged.
-- Caller must supply GitHub owner ID from the two verified repository API
-- reads, not from a webhook, callback token, or user-provided body.

create or replace function boardreadyops_record_protected_release_intent_candidate_v2(
  p_installation_id text,
  p_repository_id text,
  p_github_installation_id bigint,
  p_github_repository_id bigint,
  p_github_owner_id bigint,
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
  if p_github_owner_id is null or p_github_owner_id <= 0
     or p_actor_github_user_id is null or p_actor_github_user_id <= 0
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
    installation_id, repository_id, github_repository_id, github_owner_id,
    actor_github_user_id, actor_login, ref, commit_sha, request_id,
    evidence_version, evidence_digest, observed_at
  ) values (
    p_installation_id, p_repository_id, p_github_repository_id, p_github_owner_id,
    p_actor_github_user_id, p_actor_login, p_ref, p_commit_sha, p_request_id,
    2, p_evidence_digest, p_now
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
     or v_candidate.github_owner_id is distinct from p_github_owner_id
     or v_candidate.actor_github_user_id is distinct from p_actor_github_user_id
     or v_candidate.actor_login is distinct from p_actor_login
     or v_candidate.ref is distinct from p_ref
     or v_candidate.commit_sha is distinct from p_commit_sha
     or v_candidate.evidence_version <> 2
     or v_candidate.evidence_digest is distinct from p_evidence_digest then
    raise exception 'protected release request id reused with different evidence'
      using errcode = '23505';
  end if;

  return query select v_candidate.id, false;
end;
$$;


insert into cloud_schema_migrations (version)
values ('0090_protected_release_verified_owner_evidence')
on conflict (version) do nothing;
