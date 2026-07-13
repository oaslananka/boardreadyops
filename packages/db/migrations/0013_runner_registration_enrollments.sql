-- One-time self-hosted runner enrollment and activation state.
-- Enrollment secrets are stored only as SHA-256 digests.

create table if not exists runner_registration_enrollments (
  id text primary key,
  installation_id text not null references installations(id) on delete cascade,
  runner_registration_id text not null references runner_registrations(id) on delete cascade,
  token_digest text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  constraint runner_registration_enrollments_id_valid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint runner_registration_enrollments_token_digest_valid
    check (token_digest ~ '^[0-9a-f]{64}$'),
  constraint runner_registration_enrollments_expiry_valid
    check (expires_at > created_at),
  constraint runner_registration_enrollments_terminal_state_valid
    check (not (consumed_at is not null and revoked_at is not null)),
  constraint runner_registration_enrollments_timestamps_valid
    check (
      (consumed_at is null or consumed_at >= created_at)
      and (revoked_at is null or revoked_at >= created_at)
    )
);

create unique index if not exists runner_registration_enrollments_one_active_idx
  on runner_registration_enrollments(runner_registration_id)
  where consumed_at is null and revoked_at is null;

create index if not exists runner_registration_enrollments_expiry_idx
  on runner_registration_enrollments(expires_at, runner_registration_id)
  where consumed_at is null and revoked_at is null;

create or replace function boardreadyops_issue_runner_registration_enrollment(
  p_now timestamptz,
  p_installation_id text,
  p_registration_id text,
  p_enrollment_id text,
  p_name text,
  p_scope text,
  p_allowed_repositories text[],
  p_token_digest text,
  p_expires_at timestamptz
)
returns table(outcome text, registration_id text, effective_expires_at timestamptz)
language plpgsql
security invoker
as $$
declare
  v_registration runner_registrations%rowtype;
  v_rotated boolean := false;
begin
  if p_expires_at <= p_now or not exists (
    select 1 from installations as installation where installation.id = p_installation_id
  ) then
    return query select 'stale'::text, null::text, null::timestamptz;
    return;
  end if;

  select registration.*
  into v_registration
  from runner_registrations as registration
  where registration.installation_id = p_installation_id
    and registration.name = p_name
  for update;

  if not found then
    insert into runner_registrations (
      id,
      installation_id,
      name,
      scope,
      allowed_repositories,
      status,
      created_at
    ) values (
      p_registration_id,
      p_installation_id,
      p_name,
      p_scope,
      p_allowed_repositories,
      'pending',
      p_now
    )
    on conflict (installation_id, name) do nothing;

    select registration.*
    into v_registration
    from runner_registrations as registration
    where registration.installation_id = p_installation_id
      and registration.name = p_name
    for update;
  end if;

  if v_registration.id is null then
    return query select 'stale'::text, null::text, null::timestamptz;
    return;
  end if;

  if v_registration.status <> 'pending' or v_registration.disabled_at is not null then
    return query select 'conflict'::text, v_registration.id, null::timestamptz;
    return;
  end if;

  update runner_registrations as registration
  set scope = p_scope,
      allowed_repositories = p_allowed_repositories
  where registration.id = v_registration.id;

  update runner_registration_enrollments as enrollment
  set revoked_at = p_now
  where enrollment.runner_registration_id = v_registration.id
    and enrollment.consumed_at is null
    and enrollment.revoked_at is null;
  v_rotated := found;

  insert into runner_registration_enrollments (
    id,
    installation_id,
    runner_registration_id,
    token_digest,
    created_at,
    expires_at
  ) values (
    p_enrollment_id,
    p_installation_id,
    v_registration.id,
    p_token_digest,
    p_now,
    p_expires_at
  );

  insert into audit_events (
    installation_id,
    event_type,
    actor_type,
    subject_type,
    subject_id,
    runner_registration_id,
    metadata,
    created_at
  ) values (
    p_installation_id,
    'runner.registration.enrollment_issued',
    'system',
    'runner_registration',
    v_registration.id,
    v_registration.id,
    jsonb_build_object(
      'enrollmentId', p_enrollment_id,
      'expiresAt', p_expires_at,
      'scope', p_scope,
      'allowedRepositoryCount', cardinality(p_allowed_repositories),
      'rotated', v_rotated
    ),
    p_now
  );

  return query select 'accepted'::text, v_registration.id, p_expires_at;
end;
$$;

create or replace function boardreadyops_activate_runner_registration(
  p_now timestamptz,
  p_token_digest text,
  p_public_key text,
  p_public_key_fingerprint text,
  p_capabilities jsonb
)
returns table(outcome text, registration_id text, installation_id text)
language plpgsql
security invoker
as $$
declare
  v_enrollment runner_registration_enrollments%rowtype;
  v_registration runner_registrations%rowtype;
begin
  select enrollment.*
  into v_enrollment
  from runner_registration_enrollments as enrollment
  where enrollment.token_digest = p_token_digest
  for update;

  if v_enrollment.id is null then
    return query select 'stale'::text, null::text, null::text;
    return;
  end if;

  select registration.*
  into v_registration
  from runner_registrations as registration
  where registration.id = v_enrollment.runner_registration_id
    and registration.installation_id = v_enrollment.installation_id
  for update;

  if v_registration.id is null then
    return query select 'stale'::text, null::text, null::text;
    return;
  end if;

  if v_enrollment.consumed_at is not null then
    if v_registration.status = 'active'
      and v_registration.disabled_at is null
      and v_registration.public_key = p_public_key
      and v_registration.public_key_fingerprint = p_public_key_fingerprint
      and v_registration.capabilities = p_capabilities
    then
      return query select 'replayed'::text, v_registration.id, v_registration.installation_id;
    else
      return query select 'conflict'::text, v_registration.id, v_registration.installation_id;
    end if;
    return;
  end if;

  if v_enrollment.revoked_at is not null or v_enrollment.expires_at <= p_now then
    return query select 'stale'::text, v_registration.id, v_registration.installation_id;
    return;
  end if;

  if v_registration.status <> 'pending' or v_registration.disabled_at is not null then
    return query select 'conflict'::text, v_registration.id, v_registration.installation_id;
    return;
  end if;

  if exists (
    select 1
    from runner_registrations as registration
    where registration.installation_id = v_registration.installation_id
      and registration.public_key_fingerprint = p_public_key_fingerprint
      and registration.id <> v_registration.id
  ) then
    return query select 'conflict'::text, v_registration.id, v_registration.installation_id;
    return;
  end if;

  update runner_registrations as registration
  set signing_algorithm = 'ed25519',
      public_key = p_public_key,
      public_key_fingerprint = p_public_key_fingerprint,
      capabilities = p_capabilities,
      status = 'active',
      activated_at = p_now,
      last_heartbeat_at = p_now,
      disabled_at = null
  where registration.id = v_registration.id;

  update runner_registration_enrollments as enrollment
  set consumed_at = p_now
  where enrollment.id = v_enrollment.id;

  update runner_registration_enrollments as enrollment
  set revoked_at = p_now
  where enrollment.runner_registration_id = v_registration.id
    and enrollment.id <> v_enrollment.id
    and enrollment.consumed_at is null
    and enrollment.revoked_at is null;

  insert into audit_events (
    installation_id,
    event_type,
    actor_type,
    actor_id,
    subject_type,
    subject_id,
    runner_registration_id,
    metadata,
    created_at
  ) values (
    v_registration.installation_id,
    'runner.registration.activated',
    'registered_actor',
    v_registration.id,
    'runner_registration',
    v_registration.id,
    v_registration.id,
    jsonb_build_object(
      'enrollmentId', v_enrollment.id,
      'publicKeyFingerprint', p_public_key_fingerprint,
      'capabilityCount', jsonb_array_length(p_capabilities)
    ),
    p_now
  );

  return query select 'accepted'::text, v_registration.id, v_registration.installation_id;
end;
$$;