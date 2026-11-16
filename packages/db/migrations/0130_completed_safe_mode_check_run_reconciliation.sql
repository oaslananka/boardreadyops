-- Do not rewrite an intentionally skipped draft/fork Check Run as a failed no-result run.
-- Migrations 0042 and 0046 make unreported failed/timed-out executions recoverable,
-- but successful safe-mode skips also have no signed result by design.
-- Only trust an exact completed, neutral GitHub outbox effect bound to the same run
-- and check ID. Missing/failed outbox evidence still reconciles fail-closed.
-- This migration updates the candidate detector only and does not change run
-- history, existing Check Runs, reconciliation leases or audit records.

create or replace function boardreadyops_detect_github_check_run_reconciliation(
  p_now timestamptz,
  p_observation_delay_seconds integer,
  p_terminal_deadline_seconds integer,
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_detected integer;
begin
  if p_observation_delay_seconds <= 0 or p_terminal_deadline_seconds <= 0 or p_limit <= 0 then
    raise exception 'Check Run reconciliation intervals and limit must be positive' using errcode = '22023';
  end if;
  if p_terminal_deadline_seconds <= p_observation_delay_seconds then
    raise exception 'Check Run reconciliation deadline must exceed observation delay' using errcode = '22023';
  end if;

  with candidates as (
    select
      gen_random_uuid()::text as reconciliation_id,
      installations.id as installation_id,
      repositories.id as repository_id,
      release_runs.id as release_run_id,
      coalesce(
        release_run_results.last_publication_attempt_at,
        release_run_results.received_at,
        -- No result row at all: the run's own completion is the only observation point.
        release_runs.completed_at
      ) as observed_from
    from release_runs
    -- Left joined so a terminal run that never reported is still a candidate. An inner join
    -- here is precisely what hid these runs.
    left join release_run_results on release_run_results.run_id = release_runs.id
    join repositories on repositories.id = release_runs.repository_id
    join installations on installations.id = repositories.installation_id
    where (release_run_results.run_id is null or release_run_results.github_check_published_at is null)
      -- A draft/fork PR was deliberately skipped, not left without a callback.
      -- Check Run completion is proven by the exact completed outbox effect and
      -- GitHub's accepted neutral conclusion. Do not infer hardware readiness.
      and not (
        release_run_results.run_id is null
        and release_runs.status = 'completed'
        and release_runs.decision = 'neutral'
        and release_runs.trust_mode = 'safe'
        and (
          'draft-pull-request' = any(release_runs.safe_mode_reasons)
          or 'fork-pull-request' = any(release_runs.safe_mode_reasons)
        )
        and exists (
          select 1
          from control_plane_outbox completed_skip
          where completed_skip.release_run_id = release_runs.id
            and completed_skip.effect_type = 'github.check_run.complete'
            and completed_skip.status = 'completed'
            and completed_skip.payload -> 'input' ->> 'checkRunId' = release_runs.github_check_run_id::text
            and completed_skip.payload -> 'input' ->> 'conclusion' = 'neutral'
            and completed_skip.external_result ->> 'githubCheckRunId' = release_runs.github_check_run_id::text
            and completed_skip.external_result ->> 'conclusion' = 'neutral'
        )
      )
      and release_runs.github_check_run_id is not null
      and release_runs.status in ('completed', 'failed', 'timed_out')
      and coalesce(
            release_run_results.last_publication_attempt_at,
            release_run_results.received_at,
            release_runs.completed_at
          ) is not null
      and coalesce(
            release_run_results.last_publication_attempt_at,
            release_run_results.received_at,
            release_runs.completed_at
          ) <= p_now - make_interval(secs => p_observation_delay_seconds)
      and not exists (
        select 1
        from control_plane_reconciliation_items existing
        where existing.installation_id = installations.id
          and existing.subject_type = 'release_run'
          and existing.subject_id = release_runs.id
          and existing.reason_code = 'reporting_stale'
      )
    order by observed_from asc, release_runs.id asc
    limit greatest(1, least(p_limit, 1000))
  ), inserted as (
    insert into control_plane_reconciliation_items (
      id,
      installation_id,
      repository_id,
      release_run_id,
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
      candidates.release_run_id,
      'release_run',
      candidates.release_run_id,
      'reporting_stale',
      'available',
      candidates.observed_from + make_interval(secs => p_terminal_deadline_seconds),
      p_now,
      0,
      12,
      p_now
    from candidates
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_detected from inserted;

  return coalesce(v_detected, 0);
end;
$$;

insert into cloud_schema_migrations (version)
values ('0130_completed_safe_mode_check_run_reconciliation')
on conflict (version) do nothing;
