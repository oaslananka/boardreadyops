from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


migrations_test = Path("tests/unit/db/migrations.test.ts")
text = migrations_test.read_text()
text = replace_once(
    text,
    'it("publishes the runner-protocol schema version and models", () => {',
    'it("publishes the cloud schema version and models", () => {',
    "migration schema test title",
)
text = replace_once(
    text,
    "expect(cloudDatabaseSchemaVersion).toBe(18);",
    "expect(cloudDatabaseSchemaVersion).toBe(19);",
    "migration schema version",
)
text = replace_once(
    text,
    '    expect(cloudDatabaseModels).toContain("ControlPlaneOutbox");\n',
    '    expect(cloudDatabaseModels).toContain("ControlPlaneOutbox");\n'
    '    expect(cloudDatabaseModels).toContain("ControlPlaneReconciliationItem");\n'
    '    expect(cloudDatabaseModels).toContain("ControlPlaneReplayOperation");\n',
    "migration models",
)
text = replace_once(
    text,
    '      "0018_control_plane_outbox_transitions.sql",\n',
    '      "0018_control_plane_outbox_transitions.sql",\n'
    '      "0019_control_plane_reconciliation_operations.sql",\n',
    "migration order",
)
migrations_test.write_text(text)

store = Path("packages/db/src/control-plane-operations-store.ts")
text = store.read_text()
text = replace_once(
    text,
    'const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;\n',
    'const reasonCodePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;\n'
    'const credentialAssignmentPattern =\n'
    '  /\\b(authorization|cookie|credential|password|private[_-]?key|secret|token)\\s*[=:]\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s,;]+)/giu;\n'
    'const bearerPattern = /\\bBearer\\s+[a-z0-9._~+/=-]+/giu;\n',
    "failure sanitizers",
)
text = replace_once(
    text,
    '  boolean(column: string): boolean | undefined {\n'
    '    const value = this.value?.[column];\n'
    '    if (typeof value === "boolean") return value;\n'
    '    if (value === "true" || value === "t") return true;\n'
    '    if (value === "false" || value === "f") return false;\n'
    '    return undefined;\n'
    '  }\n',
    '  boolean(column: string): boolean | undefined {\n'
    '    const value = this.value?.[column];\n'
    '    if (typeof value === "boolean") return value;\n'
    '    if (value === "true" || value === "t") return true;\n'
    '    if (value === "false" || value === "f") return false;\n'
    '    return undefined;\n'
    '  }\n\n'
    '  timestamp(column: string): string | undefined {\n'
    '    const value = this.value?.[column];\n'
    '    if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();\n'
    '    if (typeof value !== "string") return undefined;\n'
    '    const parsed = new Date(value);\n'
    '    return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : undefined;\n'
    '  }\n',
    "timestamp decoder",
)
text = replace_once(
    text,
    'function boundedFailure(value: string, maximum: number, fallback: string): string {\n'
    '  const normalized = value.replace(/[\\r\\n\\t]+/gu, " ").trim();\n'
    '  return (normalized || fallback).slice(0, maximum);\n'
    '}\n',
    'function boundedFailure(value: string, maximum: number, fallback: string): string {\n'
    '  const normalized = value\n'
    '    .replace(bearerPattern, "Bearer [REDACTED]")\n'
    '    .replace(credentialAssignmentPattern, "$1=[REDACTED]")\n'
    '    .replace(/[\\r\\n\\t]+/gu, " ")\n'
    '    .trim();\n'
    '  return (normalized || fallback).slice(0, maximum);\n'
    '}\n',
    "bounded failure sanitizer",
)
text = replace_once(
    text,
    'function requiredText(row: DatabaseRow, column: string, label: string): string {\n'
    '  const value = row.text(column);\n'
    '  if (!value) throw new Error(`control-plane operations query returned an incomplete ${label}`);\n'
    '  return value;\n'
    '}\n',
    'function requiredText(row: DatabaseRow, column: string, label: string): string {\n'
    '  const value = row.text(column);\n'
    '  if (!value) throw new Error(`control-plane operations query returned an incomplete ${label}`);\n'
    '  return value;\n'
    '}\n\n'
    'function requiredTimestamp(row: DatabaseRow, column: string, label: string): string {\n'
    '  const value = row.timestamp(column);\n'
    '  if (!value) throw new Error(`control-plane operations query returned an incomplete ${label}`);\n'
    '  return value;\n'
    '}\n',
    "required timestamp",
)
text = replace_once(
    text,
    '    failedAt: requiredText(row, "failed_at", "dead letter"),',
    '    failedAt: requiredTimestamp(row, "failed_at", "dead letter"),',
    "dead-letter timestamp",
)
text = replace_once(
    text,
    '    deadlineAt: requiredText(row, "deadline_at", "reconciliation item"),\n'
    '    nextCheckAt: requiredText(row, "next_check_at", "reconciliation item"),',
    '    deadlineAt: requiredTimestamp(row, "deadline_at", "reconciliation item"),\n'
    '    nextCheckAt: requiredTimestamp(row, "next_check_at", "reconciliation item"),',
    "reconciliation timestamps",
)
store.write_text(text)

store_test = Path("tests/unit/db/control-plane-operations-store.test.ts")
text = store_test.read_text()
text = replace_once(
    text,
    '              failed_at: "2026-07-22T15:55:00.000Z",',
    '              failed_at: new Date("2026-07-22T15:55:00.000Z"),',
    "dead-letter Date fixture",
)
text = replace_once(
    text,
    '              deadline_at: "2026-07-22T16:05:00.000Z",\n'
    '              next_check_at: "2026-07-22T16:00:00.000Z",',
    '              deadline_at: new Date("2026-07-22T16:05:00.000Z"),\n'
    '              next_check_at: new Date("2026-07-22T16:00:00.000Z"),',
    "reconciliation Date fixtures",
)
marker = '  it("rejects malformed tenant, worker, and operation identifiers", async () => {'
sanitizer_test = '''  it("redacts credentials from persisted reconciliation failures", async () => {
    const executor: SqlQueryExecutor = {
      async query(sql, params) {
        expect(sql).toContain("boardreadyops_fail_control_plane_reconciliation");
        expect(String(params?.[5])).not.toContain("authorization=");
        expect(String(params?.[5])).toContain("[REDACTED]");
        return { rows: [{ outcome: "retry" }] };
      },
    };

    await expect(
      createSqlControlPlaneOperationsStore(executor, { now: () => now }).failReconciliationItem({
        reconciliationId: "reconciliation-1",
        workerId: "worker-1",
        attemptCount: 1,
        errorClass: "NetworkError",
        errorMessage: `authorization=Bearer ${"x".repeat(200)}`,
      }),
    ).resolves.toBe("retry");
  });

'''
text = replace_once(text, marker, sanitizer_test + marker, "sanitizer test insertion")
store_test.write_text(text)

migration = Path("packages/db/migrations/0019_control_plane_reconciliation_operations.sql")
text = migration.read_text()
text = replace_once(
    text,
    'alter table webhook_inbox\n  add column if not exists accepted_at timestamptz not null default clock_timestamp();\n',
    'alter table webhook_inbox\n  add column if not exists accepted_at timestamptz;\n\n'
    'update webhook_inbox\n'
    '   set accepted_at = received_at\n'
    ' where accepted_at is null;\n\n'
    'alter table webhook_inbox\n'
    '  alter column accepted_at set default clock_timestamp(),\n'
    '  alter column accepted_at set not null;\n',
    "acceptance latency backfill",
)
text = replace_once(
    text,
    '  operation_id text primary key,\n'
    '  installation_id text not null references installations(id) on delete cascade,',
    '  operation_id text not null,\n'
    '  installation_id text not null references installations(id) on delete cascade,',
    "tenant replay key columns",
)
text = replace_once(
    text,
    '  constraint control_plane_replay_outcome_valid check (\n'
    "    outcome in ('not_found', 'not_replayable', 'replayed')\n"
    '  )\n'
    ');',
    '  constraint control_plane_replay_outcome_valid check (\n'
    "    outcome in ('not_found', 'not_replayable', 'replayed')\n"
    '  ),\n'
    '  primary key (installation_id, operation_id)\n'
    ');',
    "tenant replay primary key",
)
start = text.index("create or replace function boardreadyops_replay_control_plane_dead_letter(")
end = text.index("create or replace function boardreadyops_enqueue_control_plane_reconciliation(", start)
replay_function = '''create or replace function boardreadyops_replay_control_plane_dead_letter(
  p_installation_id text,
  p_item_type text,
  p_item_id text,
  p_operation_id text,
  p_actor_id text,
  p_now timestamptz
)
returns table(outcome text, audit_event_id text)
language plpgsql
security invoker
as $$
declare
  v_existing control_plane_replay_operations%rowtype;
  v_repository_id text;
  v_release_run_id text;
  v_audit_event_id text;
  v_status text;
  v_outcome text;
begin
  select * into v_existing
    from control_plane_replay_operations
   where installation_id = p_installation_id
     and operation_id = p_operation_id
   for update;

  if found then
    if v_existing.item_type <> p_item_type
       or v_existing.item_id <> p_item_id
       or v_existing.actor_id <> p_actor_id then
      raise exception 'replay operation id was reused for a different request' using errcode = '23505';
    end if;
    return query select 'already_applied'::text, v_existing.audit_event_id;
    return;
  end if;

  if p_item_type = 'job' then
    select r.id, cpj.status
      into v_repository_id, v_status
      from control_plane_jobs cpj
      join webhook_inbox wi on wi.id = cpj.inbox_id
      join installations i on i.github_installation_id = wi.installation_external_id
      left join repositories r
        on r.installation_id = i.id
       and r.github_repo_id = wi.repository_external_id
     where cpj.id = p_item_id
       and i.id = p_installation_id
     for update of cpj;

    if not found then
      v_outcome := 'not_found';
    elsif v_status <> 'dead_letter' then
      v_outcome := 'not_replayable';
    else
      update control_plane_jobs
         set status = 'available',
             available_at = p_now,
             attempt_count = 0,
             lease_owner = null,
             lease_expires_at = null,
             started_at = null,
             completed_at = null,
             last_error_class = null,
             last_error_message = null
       where id = p_item_id;

      update webhook_inbox wi
         set state = 'accepted',
             processing_started_at = null,
             processed_at = null,
             last_error_class = null,
             last_error_message = null
        from control_plane_jobs cpj
       where cpj.id = p_item_id
         and wi.id = cpj.inbox_id;
      v_outcome := 'replayed';
    end if;
  elsif p_item_type = 'outbox' then
    select r.id, rr.id, cpo.status
      into v_repository_id, v_release_run_id, v_status
      from control_plane_outbox cpo
      join release_runs rr on rr.id = cpo.release_run_id
      join repositories r on r.id = rr.repository_id
     where cpo.id = p_item_id
       and r.installation_id = p_installation_id
     for update of cpo;

    if not found then
      v_outcome := 'not_found';
    elsif v_status = 'reconciliation_required' then
      v_outcome := 'not_replayable';
    elsif v_status <> 'dead_letter' then
      v_outcome := 'not_replayable';
    else
      update control_plane_outbox
         set status = 'available',
             available_at = p_now,
             attempt_count = 0,
             lease_owner = null,
             lease_expires_at = null,
             delivery_started_at = null,
             completed_at = null,
             external_result = null,
             last_error_class = null,
             last_error_message = null
       where id = p_item_id;
      v_outcome := 'replayed';
    end if;
  else
    raise exception 'unsupported dead-letter item type' using errcode = '22023';
  end if;

  if v_outcome = 'replayed' then
    v_audit_event_id := gen_random_uuid()::text;
    insert into audit_events (
      id, installation_id, event_type, actor_type, actor_id,
      subject_type, subject_id, repository_id, release_run_id,
      request_id, metadata, created_at
    ) values (
      v_audit_event_id, p_installation_id, 'control_plane.dead_letter_replayed',
      'operator', p_actor_id,
      case when p_item_type = 'job' then 'control_plane_job' else 'control_plane_outbox' end,
      p_item_id, v_repository_id, v_release_run_id,
      p_operation_id,
      jsonb_build_object('itemType', p_item_type, 'outcome', v_outcome),
      p_now
    );
  end if;

  insert into control_plane_replay_operations (
    operation_id, installation_id, item_type, item_id, actor_id,
    outcome, audit_event_id, created_at
  ) values (
    p_operation_id, p_installation_id, p_item_type, p_item_id, p_actor_id,
    v_outcome, v_audit_event_id, p_now
  );

  return query select v_outcome, v_audit_event_id;
end;
$$;

'''
text = text[:start] + replay_function + text[end:]
migration.write_text(text)
