-- Permanent operator-controlled revocation for customer-hosted runner registrations.
-- Revoked identities are never reactivated or reused.

create or replace function public.boardreadyops_revoke_runner_registration(
  p_now timestamptz,
  p_installation_id text,
  p_registration_id text,
  p_actor_id text,
  p_reason text
)
returns table(
  outcome text,
  registration_id text,
  revoked_enrollment_count integer,
  revoked_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_registration public.runner_registrations%rowtype;
  v_revoked_enrollment_count integer := 0;
begin
  if p_now is null
    or p_installation_id is null
    or p_installation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_registration_id is null
    or p_registration_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_actor_id is null
    or p_actor_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$'
    or p_reason is null
    or p_reason not in (
      'credential-rotation',
      'host-decommissioned',
      'policy-change',
      'operator-request',
      'suspected-compromise'
    )
  then
    return query select 'stale'::text, null::text, 0, null::timestamptz;
    return;
  end if;

  -- Match activation's enrollment-then-registration lock order while preserving tenant scope.
  perform enrollment.id
  from public.runner_registration_enrollments as enrollment
  join public.runner_registrations as registration
    on registration.id = enrollment.runner_registration_id
   and registration.installation_id = enrollment.installation_id
  where registration.id = p_registration_id
    and registration.installation_id = p_installation_id
    and enrollment.consumed_at is null
    and enrollment.revoked_at is null
  for update of enrollment;

  select registration.*
  into v_registration
  from public.runner_registrations as registration
  where registration.id = p_registration_id
    and registration.installation_id = p_installation_id
  for update;

  if v_registration.id is null then
    return query select 'stale'::text, null::text, 0, null::timestamptz;
    return;
  end if;

  if v_registration.status = 'disabled' and v_registration.disabled_at is not null then
    return query select 'replayed'::text, v_registration.id, 0, v_registration.disabled_at;
    return;
  end if;

  update public.runner_registration_enrollments as enrollment
  set revoked_at = p_now
  where enrollment.runner_registration_id = v_registration.id
    and enrollment.consumed_at is null
    and enrollment.revoked_at is null;
  get diagnostics v_revoked_enrollment_count = row_count;

  update public.runner_registrations as registration
  set status = 'disabled',
      disabled_at = p_now
  where registration.id = v_registration.id;

  insert into public.audit_events (
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
    'runner.registration.revoked',
    'operator',
    p_actor_id,
    'runner_registration',
    v_registration.id,
    v_registration.id,
    jsonb_build_object(
      'reason', p_reason,
      'previousStatus', v_registration.status,
      'revokedEnrollmentCount', v_revoked_enrollment_count
    ),
    p_now
  );

  return query select 'accepted'::text, v_registration.id, v_revoked_enrollment_count, p_now;
end;
$$;
