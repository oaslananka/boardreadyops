-- Tenant-scoped reconciliation for webhook inbox and lifecycle-job drift.

alter table control_plane_reconciliation_items
  drop constraint if exists control_plane_reconciliation_subject_type_valid;

alter table control_plane_reconciliation_items
  add constraint control_plane_reconciliation_subject_type_valid check (
    subject_type in ('job', 'outbox', 'release_run', 'execution_attempt', 'webhook_inbox')
  );

create or replace function boardreadyops_validate_reconciliation_scope()
returns trigger
language plpgsql
as $$
declare
  v_installation_id text;
  v_repository_id text;
  v_release_run_id text;
  v_execution_attempt_id text;
begin
  if new.subject_type = 'webhook_inbox' then
    select i.id, r.id
      into v_installation_id, v_repository_id
      from webhook_inbox wi
      join installations i on i.github_installation_id = wi.installation_external_id
      left join repositories r
        on r.installation_id = i.id
       and r.github_repo_id = wi.repository_external_id
     where wi.id = new.subject_id;
  elsif new.subject_type = 'job' then
    select i.id, r.id
      into v_installation_id, v_repository_id
      from control_plane_jobs cpj
      join webhook_inbox wi on wi.id = cpj.inbox_id
      join installations i on i.github_installation_id = wi.installation_external_id
      left join repositories r
        on r.installation_id = i.id
       and r.github_repo_id = wi.repository_external_id
     where cpj.id = new.subject_id;
  elsif new.subject_type = 'outbox' then
    select i.id, r.id, rr.id, cpo.execution_attempt_id
      into v_installation_id, v_repository_id, v_release_run_id, v_execution_attempt_id
      from control_plane_outbox cpo
      join release_runs rr on rr.id = cpo.release_run_id
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
     where cpo.id = new.subject_id;
  elsif new.subject_type = 'release_run' then
    select i.id, r.id, rr.id
      into v_installation_id, v_repository_id, v_release_run_id
      from release_runs rr
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
     where rr.id = new.subject_id;
  elsif new.subject_type = 'execution_attempt' then
    select i.id, r.id, rr.id, rra.id
      into v_installation_id, v_repository_id, v_release_run_id, v_execution_attempt_id
      from release_run_attempts rra
      join release_runs rr on rr.id = rra.run_id
      join repositories r on r.id = rr.repository_id
      join installations i on i.id = r.installation_id
     where rra.id = new.subject_id;
  end if;

  if v_installation_id is null then
    raise exception 'reconciliation subject was not found' using errcode = '23503';
  end if;

  if new.installation_id <> v_installation_id then
    raise exception 'reconciliation subject does not belong to installation' using errcode = '23514';
  end if;

  if new.repository_id is not null and new.repository_id is distinct from v_repository_id then
    raise exception 'reconciliation repository scope does not match subject' using errcode = '23514';
  end if;

  if new.release_run_id is not null and new.release_run_id is distinct from v_release_run_id then
    raise exception 'reconciliation release-run scope does not match subject' using errcode = '23514';
  end if;

  if new.execution_attempt_id is not null
     and new.execution_attempt_id is distinct from v_execution_attempt_id then
    raise exception 'reconciliation attempt scope does not match subject' using errcode = '23514';
  end if;

  new.repository_id := coalesce(new.repository_id, v_repository_id);
  new.release_run_id := coalesce(new.release_run_id, v_release_run_id);
  new.execution_attempt_id := coalesce(new.execution_attempt_id, v_execution_attempt_id);
  return new;
end;
$$;

create or replace function boardreadyops_detect_control_plane_lifecycle_reconciliation(
  p_now timestamptz,
  p_observation_delay_seconds integer,
  p_terminal_deadline_seconds integer,
  p_limit integer default 100
)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_detected bigint;
begin
  if p_observation_delay_seconds < 1 or p_terminal_deadline_seconds < 1 or p_limit < 1 then
    raise exception 'lifecycle reconciliation intervals and limit must be positive' using errcode = '22023';
  end if;
  if p_terminal_deadline_seconds <= p_observation_delay_seconds then
    raise exception 'lifecycle reconciliation deadline must exceed observation delay' using errcode = '22023';
  end if;

  with candidates as (
    select
      gen_random_uuid()::text as reconciliation_id,
      i.id as installation_id,
      r.id as repository_id,
      wi.id as inbox_id,
      cpj.id as job_id,
      case when cpj.id is null then 'webhook_inbox' else 'job' end as subject_type,
      case when cpj.id is null then wi.id else cpj.id end as subject_id,
      case
        when cpj.id is null then 'lifecycle_job_missing'
        else 'lifecycle_inbox_state_drift'
      end as reason_code
    from webhook_inbox wi
    join installations i on i.github_installation_id = wi.installation_external_id
    left join repositories r
      on r.installation_id = i.id
     and r.github_repo_id = wi.repository_external_id
    left join control_plane_jobs cpj on cpj.inbox_id = wi.id
    where wi.accepted_at <= p_now - make_interval(secs => p_observation_delay_seconds)
      and (
        (cpj.id is null and wi.state in ('accepted', 'processing'))
        or (
          cpj.id is not null
          and wi.state is distinct from case cpj.status
            when 'available' then 'accepted'
            when 'leased' then 'processing'
            when 'completed' then 'processed'
            when 'dead_letter' then 'dead_letter'
          end
        )
      )
    order by wi.accepted_at asc, wi.id asc
    for update of wi skip locked
    limit greatest(1, least(p_limit, 1000))
  ), inserted as (
    insert into control_plane_reconciliation_items (
      id,
      installation_id,
      repository_id,
      subject_type,
      subject_id,
      reason_code,
      status,
      deadline_at,
      next_check_at,
      attempt_count,
      max_attempts,
      created_at
    )
    select
      candidates.reconciliation_id,
      candidates.installation_id,
      candidates.repository_id,
      candidates.subject_type,
      candidates.subject_id,
      candidates.reason_code,
      'available',
      p_now + make_interval(secs => p_terminal_deadline_seconds),
      p_now,
      0,
      12,
      p_now
    from candidates
    on conflict do nothing
    returning id
  )
  select count(*) into v_detected from inserted;

  return coalesce(v_detected, 0);
end;
$$;

create or replace function boardreadyops_claim_control_plane_lifecycle_reconciliation(
  p_worker_id text,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_limit integer default 1
)
returns table(
  reconciliation_id text,
  installation_id text,
  repository_id text,
  release_run_id text,
  execution_attempt_id text,
  subject_type text,
  subject_id text,
  reason_code text,
  deadline_at timestamptz,
  next_check_at timestamptz,
  attempt_count integer
)
language plpgsql
security invoker
as $$
begin
  with expired as (
    select cpri.id, cpri.attempt_count, cpri.max_attempts
      from control_plane_reconciliation_items cpri
     where cpri.status = 'leased'
       and cpri.reason_code in ('lifecycle_job_missing', 'lifecycle_inbox_state_drift')
       and cpri.lease_expires_at <= p_now
     for update skip locked
  )
  update control_plane_reconciliation_items cpri
     set status = case when expired.attempt_count >= expired.max_attempts then 'dead_letter' else 'available' end,
         next_check_at = case when expired.attempt_count >= expired.max_attempts then cpri.next_check_at else p_now end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = case when expired.attempt_count >= expired.max_attempts then p_now else null end,
         public_failure_reason = case
           when expired.attempt_count >= expired.max_attempts then 'operator_replay_required'
           else null
         end,
         last_error_class = 'lease_expired',
         last_error_message = 'The lifecycle reconciliation lease expired before completion.'
    from expired
   where cpri.id = expired.id;

  return query
  with candidates as (
    select cpri.id
      from control_plane_reconciliation_items cpri
     where cpri.status = 'available'
       and cpri.reason_code in ('lifecycle_job_missing', 'lifecycle_inbox_state_drift')
       and cpri.next_check_at <= p_now
     order by cpri.next_check_at asc, cpri.deadline_at asc, cpri.created_at asc, cpri.id asc
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update control_plane_reconciliation_items cpri
       set status = 'leased',
           attempt_count = cpri.attempt_count + 1,
           lease_owner = p_worker_id,
           lease_expires_at = p_lease_expires_at,
           completed_at = null,
           outcome_code = null,
           repaired = false,
           public_failure_reason = null,
           last_error_class = null,
           last_error_message = null
      from candidates
     where cpri.id = candidates.id
    returning cpri.*
  )
  select claimed.id, claimed.installation_id, claimed.repository_id,
         claimed.release_run_id, claimed.execution_attempt_id,
         claimed.subject_type, claimed.subject_id, claimed.reason_code,
         claimed.deadline_at, claimed.next_check_at, claimed.attempt_count
    from claimed
   order by claimed.next_check_at asc, claimed.deadline_at asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function boardreadyops_project_lifecycle_inbox_state(
  p_job_id text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
declare
  v_job control_plane_jobs%rowtype;
  v_inbox webhook_inbox%rowtype;
  v_expected_state text;
begin
  select * into v_job
    from control_plane_jobs
   where id = p_job_id
   for update;

  if v_job.id is null then
    return 'subject_missing';
  end if;

  select * into v_inbox
    from webhook_inbox
   where id = v_job.inbox_id
   for update;

  if v_inbox.id is null then
    return 'subject_missing';
  end if;

  v_expected_state := case v_job.status
    when 'available' then 'accepted'
    when 'leased' then 'processing'
    when 'completed' then 'processed'
    when 'dead_letter' then 'dead_letter'
  end;

  if v_inbox.state = v_expected_state then
    return 'already_repaired';
  end if;

  update webhook_inbox
     set state = v_expected_state,
         processing_started_at = case
           when v_expected_state = 'accepted' then null
           when v_expected_state = 'processing' then coalesce(v_job.started_at, p_now)
           else coalesce(v_inbox.processing_started_at, v_job.started_at)
         end,
         processed_at = case
           when v_expected_state in ('processed', 'dead_letter') then coalesce(v_job.completed_at, p_now)
           else null
         end,
         normalized_actions = case when v_expected_state = 'processed' then '[]'::jsonb
           else v_inbox.normalized_actions end,
         last_error_class = case when v_expected_state = 'processed' then null else v_job.last_error_class end,
         last_error_message = case when v_expected_state = 'processed' then null else v_job.last_error_message end
   where id = v_inbox.id;

  return 'applied';
end;
$$;

create or replace function boardreadyops_apply_control_plane_lifecycle_reconciliation(
  p_reconciliation_id text,
  p_worker_id text,
  p_now timestamptz
)
returns text
language plpgsql
security invoker
as $$
declare
  v_item control_plane_reconciliation_items%rowtype;
  v_inbox webhook_inbox%rowtype;
  v_job control_plane_jobs%rowtype;
  v_created_job_id text;
  v_projection text;
  v_completion text;
begin
  select * into v_item
    from control_plane_reconciliation_items
   where id = p_reconciliation_id
     and status = 'leased'
     and lease_owner = p_worker_id
     and reason_code in ('lifecycle_job_missing', 'lifecycle_inbox_state_drift')
   for update;

  if v_item.id is null then
    return 'stale';
  end if;

  if v_item.subject_type = 'webhook_inbox' and v_item.reason_code = 'lifecycle_job_missing' then
    select * into v_inbox
      from webhook_inbox
     where id = v_item.subject_id
     for update;

    if v_inbox.id is null or v_inbox.state not in ('accepted', 'processing') then
      v_completion := boardreadyops_complete_control_plane_reconciliation(
        p_reconciliation_id,
        p_worker_id,
        p_now,
        'lifecycle_inbox_already_terminal',
        false,
        null
      );
      return case when v_completion = 'completed' then 'already_terminal' else 'stale' end;
    end if;

    select * into v_job
      from control_plane_jobs
     where inbox_id = v_inbox.id
     for update;

    if v_job.id is null then
      insert into control_plane_jobs (
        id,
        inbox_id,
        job_type,
        payload_version,
        idempotency_key,
        priority,
        status,
        available_at,
        attempt_count,
        created_at
      ) values (
        gen_random_uuid()::text,
        v_inbox.id,
        'github_webhook.lifecycle',
        1,
        v_inbox.provider || ':' || v_inbox.delivery_id,
        100,
        'available',
        p_now,
        0,
        p_now
      )
      on conflict do nothing
      returning id into v_created_job_id;

      if v_created_job_id is not null then
        update webhook_inbox
           set state = 'accepted',
               processing_started_at = null,
               processed_at = null,
               last_error_class = null,
               last_error_message = null
         where id = v_inbox.id;

        v_completion := boardreadyops_complete_control_plane_reconciliation(
          p_reconciliation_id,
          p_worker_id,
          p_now,
          'lifecycle_job_recreated',
          true,
          null
        );
        return case when v_completion = 'completed' then 'applied' else 'stale' end;
      end if;

      select * into v_job
        from control_plane_jobs
       where inbox_id = v_inbox.id
       for update;
    end if;

    if v_job.id is null then
      raise exception 'lifecycle job idempotency conflict' using errcode = '23505';
    end if;

    v_projection := boardreadyops_project_lifecycle_inbox_state(v_job.id, p_now);
    v_completion := boardreadyops_complete_control_plane_reconciliation(
      p_reconciliation_id,
      p_worker_id,
      p_now,
      case when v_projection = 'applied' then 'lifecycle_inbox_state_repaired' else 'lifecycle_job_already_present' end,
      v_projection = 'applied',
      null
    );
    if v_completion <> 'completed' then
      return 'stale';
    end if;
    return case when v_projection = 'applied' then 'applied' else 'already_repaired' end;
  end if;

  if v_item.subject_type = 'job' and v_item.reason_code = 'lifecycle_inbox_state_drift' then
    v_projection := boardreadyops_project_lifecycle_inbox_state(v_item.subject_id, p_now);
    if v_projection = 'subject_missing' then
      v_completion := boardreadyops_complete_control_plane_reconciliation(
        p_reconciliation_id,
        p_worker_id,
        p_now,
        'lifecycle_subject_missing',
        false,
        null
      );
      return case when v_completion = 'completed' then 'already_terminal' else 'stale' end;
    end if;

    v_completion := boardreadyops_complete_control_plane_reconciliation(
      p_reconciliation_id,
      p_worker_id,
      p_now,
      case when v_projection = 'applied' then 'lifecycle_inbox_state_repaired' else 'lifecycle_inbox_already_current' end,
      v_projection = 'applied',
      null
    );
    if v_completion <> 'completed' then
      return 'stale';
    end if;
    return case when v_projection = 'applied' then 'applied' else 'already_repaired' end;
  end if;

  v_completion := boardreadyops_complete_control_plane_reconciliation(
    p_reconciliation_id,
    p_worker_id,
    p_now,
    'lifecycle_subject_unsupported',
    false,
    null
  );
  return case when v_completion = 'completed' then 'already_terminal' else 'stale' end;
end;
$$;
