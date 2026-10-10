-- Persist bounded, runner-observed tool versions only after the existing guarded
-- result transition accepts the exact run and execution attempt. Both updates
-- execute inside one PostgreSQL transaction; rejected/replayed results never write.
-- Retain the legacy transition signature for mixed-version deployments.
create function boardreadyops_apply_runner_result_with_versions(
  p_release_run_id text,
  p_apply boolean,
  p_expected_run_status text,
  p_expected_run_version bigint,
  p_expected_execution_attempt_id text,
  p_expected_attempt_status text,
  p_expected_attempt_version bigint,
  p_result_status text,
  p_decision text,
  p_received_at timestamptz,
  p_terminal_result_digest text,
  p_result_digest text,
  p_kicad_version text,
  p_board_ready_ops_version text
)
returns table(
  transition_outcome text,
  run_status text,
  run_version bigint,
  attempt_status text,
  attempt_version bigint,
  run_changed boolean,
  attempt_changed boolean
)
language plpgsql
security invoker
as $$
declare
  v_transition record;
begin
  if (p_kicad_version is not null and
      (length(p_kicad_version) > 64 or p_kicad_version !~ '^[0-9][0-9A-Za-z.+_-]*$'))
    or (p_board_ready_ops_version is not null and
      (length(p_board_ready_ops_version) > 64 or p_board_ready_ops_version !~ '^[0-9][0-9A-Za-z.+_-]*$'))
  then
    raise exception 'invalid runner tool version metadata' using errcode = '22023';
  end if;

  select * into strict v_transition from boardreadyops_apply_runner_result_state(
    p_release_run_id, p_apply, p_expected_run_status, p_expected_run_version,
    p_expected_execution_attempt_id, p_expected_attempt_status, p_expected_attempt_version,
    p_result_status, p_decision, p_received_at, p_terminal_result_digest, p_result_digest
  );

  if v_transition.transition_outcome = 'applied' then
    update release_runs
       set kicad_version = p_kicad_version,
           board_ready_ops_version = p_board_ready_ops_version
     where id = p_release_run_id
       and execution_attempt_id is not distinct from p_expected_execution_attempt_id
       and terminal_result_digest is not distinct from p_terminal_result_digest;
    if not found then
      raise exception 'release run identity changed after signed result transition'
        using errcode = '40001';
    end if;
  end if;

  return query select
    v_transition.transition_outcome::text,
    v_transition.run_status::text,
    v_transition.run_version::bigint,
    v_transition.attempt_status::text,
    v_transition.attempt_version::bigint,
    v_transition.run_changed::boolean,
    v_transition.attempt_changed::boolean;
end;
$$;

insert into cloud_schema_migrations (version)
values ('0087_signed_runner_tool_versions')
on conflict (version) do nothing;
