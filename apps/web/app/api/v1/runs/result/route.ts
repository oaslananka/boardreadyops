import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type ReleaseRunResult, releaseRunResultSchema } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { verifyGitHubActionsOidcToken } from "../../../../../lib/github-actions-oidc.js";
import {
  createGitHubAppCheckRunClient,
  detailsUrl as githubDetailsUrl,
} from "../../../../../lib/github-app-check-run-client.js";
import { buildReadinessCheckOutput, buildReadinessPrComment } from "../../../../../lib/readiness-result-format.js";
import { configuredSecretValue } from "../../../../../lib/secret-value.js";

export const runtime = "nodejs";

type QueryRow = Record<string, unknown>;
type CheckConclusion = "failure" | "neutral" | "success" | "timed_out";
type ResultQueryExecutor = SqlQueryExecutor;
type GitHubAppCheckRunClient = NonNullable<ReturnType<typeof createGitHubAppCheckRunClient>>;

export type ResultRouteDependencies = {
  queryExecutor: () => ResultQueryExecutor | undefined;
  checkRunClient: () => GitHubAppCheckRunClient | undefined;
  detailsUrl: (runId: string) => string | undefined;
  now: () => Date;
  verifyOidcToken: (token: string, runId: string, executionAttemptId: string | undefined) => Promise<boolean>;
  authenticationVerified?: boolean;
  verifiedLeaseId?: string;
  artifactStorageDriver?: () => string;
};

const resultKeyEnvName = "BOARDREADYOPS" + "_RUNNER_RESULT_KEY";
const resultKeyFileEnvName = `${resultKeyEnvName}_FILE`;
const resultKeyHeaderName = "x-boardreadyops-runner-key";
const resultSignatureHeaderName = "x-boardreadyops-runner-signature";
const resultTimestampHeaderName = "x-boardreadyops-runner-timestamp";
const signatureToleranceSeconds = 10 * 60;
const maximumResultBodyBytes = 1024 * 1024;
const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }

  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function stringCell(row: QueryRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function numberCell(row: QueryRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

type PublicationTrustMode = "safe" | "standard";
type PublicationSafeModeReason = "draft-pull-request" | "fork-pull-request" | "private-repository";
type PublicationTrustSnapshot = {
  trustMode: PublicationTrustMode;
  safeModeReasons: PublicationSafeModeReason[];
};

const publicationSafeModeReasonOrder = ["draft-pull-request", "fork-pull-request", "private-repository"] as const;
const publicationSafeModeReasonSet = new Set<string>(publicationSafeModeReasonOrder);

function publicationTrustSnapshot(row: QueryRow): PublicationTrustSnapshot | undefined {
  const rawMode = row.trust_mode;
  const rawReasons = row.safe_mode_reasons;
  if (rawMode === undefined && rawReasons === undefined) {
    return { trustMode: "standard", safeModeReasons: [] };
  }
  if ((rawMode !== "safe" && rawMode !== "standard") || !Array.isArray(rawReasons)) return undefined;
  if (rawReasons.some((reason) => typeof reason !== "string" || !publicationSafeModeReasonSet.has(reason))) {
    return undefined;
  }
  const uniqueReasons = new Set(rawReasons);
  const safeModeReasons = publicationSafeModeReasonOrder.filter((reason) => uniqueReasons.has(reason));
  if (
    uniqueReasons.size !== rawReasons.length ||
    safeModeReasons.length !== rawReasons.length ||
    safeModeReasons.some((reason, index) => reason !== rawReasons[index]) ||
    (rawMode === "standard" && safeModeReasons.length !== 0) ||
    (rawMode === "safe" && safeModeReasons.length === 0)
  ) {
    return undefined;
  }
  return { trustMode: rawMode, safeModeReasons };
}

function numberLikeCell(row: QueryRow, key: string): number | string | undefined {
  const value = row[key];
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function createDefaultQueryExecutor() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return undefined;
  }

  return createPgQueryExecutor({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
}

function terminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "timed_out";
}

function artifactStorageDriver(dependencies: ResultRouteDependencies): string {
  const value = (dependencies.artifactStorageDriver?.() ?? process.env.ARTIFACT_STORAGE_DRIVER ?? "local").trim();
  return value === "local" ? "local" : "unsupported";
}

function checkConclusion(result: {
  status: string;
  decision: string | null;
  readiness?: { status: string; warnings: readonly string[] } | undefined;
  waivers?: { active: readonly unknown[]; expired: readonly unknown[] } | undefined;
  findings?: readonly { severity: string }[] | undefined;
}): CheckConclusion {
  if (result.status === "timed_out") {
    return "timed_out";
  }

  if (
    result.status === "failed" ||
    result.decision === "fail" ||
    result.decision === "error" ||
    result.readiness?.status === "blocked"
  ) {
    return "failure";
  }

  if (result.status === "completed" && result.decision === "pass") {
    const hasWarnings =
      result.readiness?.status === "at-risk" ||
      (result.readiness?.warnings.length ?? 0) > 0 ||
      (result.waivers?.active.length ?? 0) > 0 ||
      (result.waivers?.expired.length ?? 0) > 0 ||
      (result.findings?.some((finding) => ["medium", "low", "info"].includes(finding.severity)) ?? false);
    return hasWarnings ? "neutral" : "success";
  }

  return "neutral";
}

function expectedSignature(
  key: string,
  timestamp: string,
  runId: string,
  executionAttemptId: string | undefined,
  body: string,
): string {
  const signedPayload = executionAttemptId
    ? `${timestamp}.${runId}.${executionAttemptId}.${body}`
    : `${timestamp}.${runId}.${body}`;
  return `sha256=${createHmac("sha256", key).update(signedPayload).digest("hex")}`;
}

function signatureIsFresh(timestamp: string): boolean {
  const value = Number(timestamp);
  if (!Number.isInteger(value)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - value) <= signatureToleranceSeconds;
}

function secureCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function verifyRunnerAuthentication(
  request: Request,
  input: { key: string | undefined; runId: string; executionAttemptId: string | undefined; body: string },
  verifyOidcToken: ResultRouteDependencies["verifyOidcToken"],
): Promise<boolean> {
  const authorization = request.headers.get("authorization");

  if (authorization !== null) {
    const bearer = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
    const token = bearer?.[1];
    return token !== undefined && (await verifyOidcToken(token, input.runId, input.executionAttemptId));
  }

  if (process.env.BOARDREADYOPS_REQUIRE_GITHUB_OIDC === "1") {
    return false;
  }

  if (!input.key) {
    return false;
  }

  const suppliedSignature = request.headers.get(resultSignatureHeaderName);
  const suppliedTimestamp = request.headers.get(resultTimestampHeaderName);

  if (suppliedSignature && suppliedTimestamp) {
    if (!signatureIsFresh(suppliedTimestamp)) {
      return false;
    }

    return secureCompare(
      suppliedSignature,
      expectedSignature(input.key, suppliedTimestamp, input.runId, input.executionAttemptId, input.body),
    );
  }

  if (process.env.BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE === "1") {
    return false;
  }

  return request.headers.get(resultKeyHeaderName) === input.key;
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function byCanonicalJson<T>(left: T, right: T): number {
  const leftKey = JSON.stringify(left);
  const rightKey = JSON.stringify(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function normalizedResultForDigest(result: ReleaseRunResult): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    executionAttemptId: result.executionAttemptId ?? null,
    status: result.status,
    decision: result.decision,
    findings: result.findings
      .map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        path: finding.path ?? null,
      }))
      .sort(byCanonicalJson),
  };

  if (result.artifacts.length > 0) normalized.artifacts = [...result.artifacts].sort(byCanonicalJson);
  if (Object.keys(result.metrics).length > 0) {
    normalized.metrics = Object.fromEntries(Object.entries(result.metrics).sort(([a], [b]) => a.localeCompare(b)));
  }
  if (result.reportLinks.length > 0) normalized.reportLinks = [...result.reportLinks].sort(byCanonicalJson);

  return normalized;
}

function resultDigest(result: ReleaseRunResult): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizedResultForDigest(result)))
    .digest("hex");
}

function releaseDecisionAuditMetadata(result: ReleaseRunResult, githubCheckConclusion: CheckConclusion) {
  const activeWaivers = result.waivers?.active ?? [];
  const expiredWaivers = result.waivers?.expired ?? [];
  const readiness = result.readiness;

  return {
    decisionSummaryVersion: 1,
    decision: result.decision ?? "not_available",
    githubCheckConclusion,
    readinessReported: readiness !== undefined,
    waiversReported: result.waivers !== undefined,
    activeWaiverCount: activeWaivers.length,
    expiredWaiverCount: expiredWaivers.length,
    staleWaiverCount: [...activeWaivers, ...expiredWaivers].filter((waiver) => waiver.stale).length,
    ...(readiness
      ? {
          readinessStatus: readiness.status,
          readinessScore: readiness.score,
          blockingCount: readiness.blocking,
          nonBlockingCount: readiness.nonBlocking,
          missingRequiredCount: readiness.missingRequired.length,
          missingRecommendedCount: readiness.missingRecommended.length,
          warningCount: readiness.warnings.length,
        }
      : {}),
  };
}

function publicationErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

async function recordPublicationState(
  executor: ResultQueryExecutor,
  input: {
    runId: string;
    completedAt: string;
    checkRunUpdated: boolean;
    pullRequestCommentCreated: boolean;
    errors: readonly string[];
  },
): Promise<void> {
  const publicationError = input.errors.length > 0 ? input.errors.join("; ").slice(0, 4000) : null;
  await executor.query(
    `with target as (
       select release_runs.id,
              release_runs.repository_id,
              repositories.installation_id
       from release_runs
       join repositories on repositories.id = release_runs.repository_id
       where release_runs.id = $1
     ),
     updated_result as (
       update release_run_results
       set last_publication_attempt_at = $2::timestamptz,
           github_check_published_at = case
             when $3 then coalesce(github_check_published_at, $2::timestamptz)
             else github_check_published_at
           end,
           github_comment_published_at = case
             when $4 then coalesce(github_comment_published_at, $2::timestamptz)
             else github_comment_published_at
           end,
           last_publication_error = $5
       from target
       where release_run_results.run_id = target.id
       returning release_run_results.run_id
     )
     insert into audit_events (
       installation_id,
       event_type,
       actor_type,
       subject_type,
       subject_id,
       repository_id,
       release_run_id,
       metadata
     )
     select target.installation_id,
            $6,
            'system',
            'release_run',
            target.id,
            target.repository_id,
            target.id,
            jsonb_build_object(
              'checkRunUpdated', $3,
              'pullRequestCommentCreated', $4,
              'error', $5
            )
     from target
     join updated_result on updated_result.run_id = target.id`,
    [
      input.runId,
      input.completedAt,
      input.checkRunUpdated,
      input.pullRequestCommentCreated,
      publicationError,
      publicationError === null ? "runner.result.publication_succeeded" : "runner.result.publication_failed",
    ],
  );
}

export const defaultResultRouteDependencies: ResultRouteDependencies = {
  queryExecutor: createDefaultQueryExecutor,
  checkRunClient: createGitHubAppCheckRunClient,
  detailsUrl: githubDetailsUrl,
  now: () => new Date(),
  verifyOidcToken: (token, runId, executionAttemptId) =>
    verifyGitHubActionsOidcToken(token, executionAttemptId === undefined ? { runId } : { runId, executionAttemptId }),
};

export async function handleResultRequest(
  request: Request,
  dependencies: ResultRouteDependencies = defaultResultRouteDependencies,
): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const runId = searchParams.get("run_id");
  const attemptIdParameter = searchParams.get("attempt_id");
  const executionAttemptId = attemptIdParameter ?? undefined;

  if (!runId) {
    return Response.json({ ok: false, error: "run_id query parameter is required" }, { status: 400 });
  }

  if (executionAttemptId !== undefined && !lowercaseUuidPattern.test(executionAttemptId)) {
    return Response.json({ ok: false, error: "attempt_id query parameter must be a valid UUID" }, { status: 400 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumResultBodyBytes) {
      return Response.json({ ok: false, error: "runner result payload is too large" }, { status: 413 });
    }
  }

  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText, "utf8") > maximumResultBodyBytes) {
    return Response.json({ ok: false, error: "runner result payload is too large" }, { status: 413 });
  }

  const configuredKey = configuredSecretValue({
    valueName: resultKeyEnvName,
    fileName: resultKeyFileEnvName,
  });

  if (
    !dependencies.authenticationVerified &&
    !(await verifyRunnerAuthentication(
      request,
      { key: configuredKey, runId, executionAttemptId, body: bodyText },
      dependencies.verifyOidcToken,
    ))
  ) {
    return Response.json({ ok: false, error: "invalid runner result authentication" }, { status: 401 });
  }

  const body = parseJson(bodyText);

  if (body === undefined) {
    return Response.json({ ok: false, error: "invalid runner result JSON" }, { status: 400 });
  }

  const parsed = releaseRunResultSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid runner result" }, { status: 400 });
  }

  if (parsed.data.executionAttemptId !== executionAttemptId) {
    return Response.json({ ok: false, error: "execution attempt does not match callback URL" }, { status: 400 });
  }

  const executor = dependencies.queryExecutor();

  if (!executor) {
    return Response.json({ ok: false, error: "database is not configured" }, { status: 503 });
  }

  const completedAt = dependencies.now().toISOString();
  const digest = resultDigest(parsed.data);
  const terminalDigest = terminalStatus(parsed.data.status) ? digest : null;
  const findingsJson = JSON.stringify(
    parsed.data.findings.map((finding) => ({
      rule_id: finding.ruleId,
      severity: finding.severity,
      message: finding.message,
      path: finding.path ?? null,
    })),
  );
  const artifactsJson = JSON.stringify(
    parsed.data.artifacts.map((artifact) => ({
      kind: artifact.kind,
      name: artifact.name,
      storage_path: artifact.storagePath,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      role: artifact.role,
    })),
  );
  const metricsJson = JSON.stringify(parsed.data.metrics);
  const reportLinksJson = JSON.stringify(parsed.data.reportLinks);
  const payloadJson = JSON.stringify(parsed.data);
  const githubCheckConclusion = checkConclusion(parsed.data);
  const decisionAuditMetadataJson = JSON.stringify(releaseDecisionAuditMetadata(parsed.data, githubCheckConclusion));
  const updateResult = await executor.query(
    `with existing as materialized (
       select id,
              status,
              version,
              github_check_run_id,
              repository_id,
              pull_request_number,
              execution_attempt_id,
              terminal_result_digest,
              completed_at,
              trust_mode,
              safe_mode_reasons,
              (select release_run_attempts.status
               from release_run_attempts
               where release_run_attempts.id = release_runs.execution_attempt_id) as attempt_status,
              (select release_run_attempts.version
               from release_run_attempts
               where release_run_attempts.id = release_runs.execution_attempt_id) as attempt_version,
              (select release_run_results.result_digest
               from release_run_results
               where release_run_results.run_id = release_runs.id) as persisted_result_digest
       from release_runs
       where id = $1
       for update
     ),
     runner_artifact_integrity as materialized (
       select existing.id,
              case
                when $15::text is null then true
                else
                  (select count(*)
                     from runner_artifact_upload_capabilities as capability
                    where capability.run_id = existing.id
                      and capability.execution_attempt_id = $2
                      and capability.lease_id = $15) = jsonb_array_length($14::jsonb)
                  and not exists (
                    select 1
                    from runner_artifact_upload_capabilities as capability
                    left join artifacts as uploaded_artifact
                      on uploaded_artifact.id = capability.artifact_id
                     and uploaded_artifact.run_id = capability.run_id
                    where capability.run_id = existing.id
                      and capability.execution_attempt_id = $2
                      and capability.lease_id = $15
                      and (
                        capability.status <> 'uploaded'
                        or uploaded_artifact.id is null
                        or uploaded_artifact.kind <> capability.kind
                        or uploaded_artifact.name <> capability.name
                        or uploaded_artifact.storage_path <> capability.storage_path
                        or uploaded_artifact.bytes <> capability.declared_bytes
                        or uploaded_artifact.role <> capability.role
                        or not exists (
                          select 1
                          from jsonb_to_recordset($14::jsonb) as reported_artifact(
                            kind text,
                            name text,
                            storage_path text,
                            sha256 text,
                            bytes integer,
                            role text
                          )
                          where reported_artifact.kind = capability.kind
                            and reported_artifact.name = capability.name
                            and reported_artifact.storage_path = capability.storage_path
                            and reported_artifact.sha256 = uploaded_artifact.sha256
                            and reported_artifact.bytes = uploaded_artifact.bytes
                            and reported_artifact.role = capability.role
                        )
                      )
                  )
              end as matches_verified_uploads
       from existing
     ),
     classified as (
       select existing.*,
              case
                when existing.status = 'superseded' then 'superseded'
                when existing.execution_attempt_id is distinct from $2 then 'stale_attempt'
                when existing.attempt_status in ('cancelled', 'timed_out', 'stale', 'superseded') then 'stale_attempt'
                when not runner_artifact_integrity.matches_verified_uploads then 'artifact_integrity_mismatch'
                when existing.status in ('completed', 'failed', 'timed_out') then
                  case
                    when $3 in ('completed', 'failed', 'timed_out')
                      and existing.terminal_result_digest = $7
                    then 'replayed'
                    else 'conflicting_terminal_result'
                  end
                when existing.persisted_result_digest = $13 then 'replayed'
                else 'accepted'
              end as persistence_outcome
       from existing
       join runner_artifact_integrity on runner_artifact_integrity.id = existing.id
     ),
     transitioned as materialized (
       select classified.*,
              transition.transition_outcome,
              transition.run_changed,
              transition.attempt_changed
       from classified
       left join lateral boardreadyops_apply_runner_result_state(
         classified.id,
         classified.persistence_outcome = 'accepted',
         classified.status,
         classified.version,
         classified.execution_attempt_id,
         classified.attempt_status,
         classified.attempt_version,
         $3,
         $4,
         $5::timestamptz,
         $7,
         $13
       ) as transition
         on true
     ),
     effective as (
       select transitioned.*,
              case
                when transitioned.persistence_outcome <> 'accepted'
                  then transitioned.persistence_outcome
                when transitioned.transition_outcome = 'applied'
                  then 'accepted'
                when transitioned.transition_outcome in ('stale', 'not_found')
                  then 'stale_attempt'
                else 'invalid_transition'
              end as effective_outcome
       from transitioned
     ),
     updated as (
       select effective.id,
              effective.github_check_run_id,
              effective.repository_id,
              effective.pull_request_number,
              release_runs.completed_at
       from effective
       join release_runs on release_runs.id = effective.id
       where effective.effective_outcome = 'accepted'
     ),
     updated_attempt as (
       select effective.execution_attempt_id as id
       from effective
       where effective.effective_outcome = 'accepted'
         and effective.execution_attempt_id is not null
     ),
     completed_lease as (
     update runner_job_leases
     set status = 'completed',
         stage = 'reporting',
         heartbeat_at = greatest(runner_job_leases.heartbeat_at, $5::timestamptz),
         closed_at = coalesce(runner_job_leases.closed_at, $5::timestamptz),
         close_reason = coalesce(runner_job_leases.close_reason, 'Terminal result accepted.')
     from updated
     where $15::text is not null
       and $3 in ('completed', 'failed', 'timed_out')
       and runner_job_leases.id = $15
       and runner_job_leases.run_id = updated.id
       and runner_job_leases.execution_attempt_id = $2
       and runner_job_leases.status = 'active'
     returning runner_job_leases.id
   ),
     deleted_findings as (
       delete from findings
       using updated
       where findings.run_id = updated.id
       returning findings.run_id
     ),
     captured_artifacts as materialized (
       select artifact.id,
              artifact.run_id,
              artifact.kind,
              artifact.sha256,
              artifact.bytes,
              artifact.role,
              artifact.storage_path,
              updated.repository_id,
              repository.installation_id
       from artifacts as artifact
       join updated on updated.id = artifact.run_id
       join repositories as repository on repository.id = updated.repository_id
       where $15::text is null
          or not exists (
            select 1
            from runner_artifact_upload_capabilities as verified_capability
            where verified_capability.artifact_id = artifact.id
              and verified_capability.run_id = artifact.run_id
              and verified_capability.execution_attempt_id = $2
              and verified_capability.lease_id = $15
              and verified_capability.status = 'uploaded'
          )
     ),
     queued_artifact_deletions as (
       insert into artifact_deletion_jobs (
         artifact_id, installation_id, repository_id, release_run_id,
         storage_driver, storage_path, deletion_reason, artifact_kind,
         artifact_role, artifact_sha256, artifact_bytes, available_at, created_at
       )
       select captured_artifacts.id,
              captured_artifacts.installation_id,
              captured_artifacts.repository_id,
              captured_artifacts.run_id,
              $18,
              captured_artifacts.storage_path,
              'result_replaced',
              captured_artifacts.kind,
              captured_artifacts.role,
              captured_artifacts.sha256,
              captured_artifacts.bytes,
              $5::timestamptz,
              $5::timestamptz
       from captured_artifacts
       where not exists (
         select 1
         from jsonb_to_recordset($14::jsonb) as replacement(storage_path text)
         where replacement.storage_path = captured_artifacts.storage_path
       )
         and not exists (
           select 1
           from artifacts as retained_artifact
           where retained_artifact.storage_path = captured_artifacts.storage_path
             and retained_artifact.run_id <> captured_artifacts.run_id
         )
       returning artifact_id
     ),
     skipped_artifact_deletion_audit as (
       insert into audit_events (
         installation_id,
         event_type,
         actor_type,
         actor_id,
         subject_type,
         subject_id,
         repository_id,
         release_run_id,
         metadata
       )
       select captured_artifacts.installation_id,
              'artifact.object.deletion_skipped',
              'runner',
              $2,
              'artifact',
              captured_artifacts.id,
              captured_artifacts.repository_id,
              captured_artifacts.run_id,
              jsonb_build_object(
                'reason', 'storage_path_still_referenced',
                'resultDigest', $13,
                'executionAttemptId', $2,
                'bytes', captured_artifacts.bytes,
                'sha256', captured_artifacts.sha256,
                'itemType', captured_artifacts.kind,
                'scope', captured_artifacts.role
              )
       from captured_artifacts
       left join queued_artifact_deletions
         on queued_artifact_deletions.artifact_id = captured_artifacts.id
       where queued_artifact_deletions.artifact_id is null
       returning id
     ),
     deleted_artifacts as (
       delete from artifacts
       using captured_artifacts
       where artifacts.id = captured_artifacts.id
       returning artifacts.id
     ),
     artifact_deletion_audit as (
       insert into audit_events (
         installation_id,
         event_type,
         actor_type,
         actor_id,
         subject_type,
         subject_id,
         repository_id,
         release_run_id,
         metadata
       )
       select captured_artifacts.installation_id,
              'artifact.record.deleted',
              'runner',
              $2,
              'artifact',
              captured_artifacts.id,
              captured_artifacts.repository_id,
              captured_artifacts.run_id,
              jsonb_build_object(
                'reason', 'result_replaced',
                'resultDigest', $13,
                'executionAttemptId', $2,
                'bytes', captured_artifacts.bytes,
                'sha256', captured_artifacts.sha256,
                'itemType', captured_artifacts.kind,
                'scope', captured_artifacts.role
              )
       from captured_artifacts
       join deleted_artifacts on deleted_artifacts.id = captured_artifacts.id
       returning id
     ),
     cleared_children as (
       select (select count(*) from deleted_findings) as deleted_finding_count,
              (select count(*) from deleted_artifacts) as deleted_artifact_count,
              (select count(*) from queued_artifact_deletions) as queued_artifact_deletion_count,
              (select count(*) from skipped_artifact_deletion_audit) as skipped_artifact_deletion_count,
              (select count(*) from artifact_deletion_audit) as artifact_deletion_audit_count
     ),
     inserted_findings as (
       insert into findings (run_id, rule_id, severity, message, path)
       select updated.id,
              finding.rule_id,
              finding.severity,
              finding.message,
              finding.path
       from updated
       cross join cleared_children
       cross join jsonb_to_recordset($6::jsonb) as finding(
         rule_id text,
         severity text,
         message text,
         path text
       )
       returning id
     ),
     inserted_artifacts as (
       insert into artifacts (run_id, kind, name, storage_path, sha256, bytes, role)
       select updated.id,
              artifact.kind,
              artifact.name,
              artifact.storage_path,
              artifact.sha256,
              artifact.bytes,
              artifact.role
       from updated
       cross join cleared_children
       cross join jsonb_to_recordset($14::jsonb) as artifact(
         kind text,
         name text,
         storage_path text,
         sha256 text,
         bytes integer,
         role text
       )
       where $15::text is null
       returning id
     ),
     upserted_result as (
       insert into release_run_results (
         run_id,
         execution_attempt_id,
         contract_version,
         status,
         conclusion,
         github_check_conclusion,
         decision,
         metrics,
         report_links,
         payload,
         result_digest,
         received_at
       )
       select updated.id,
              $2,
              $8,
              $3,
              $9,
              $16,
              $4,
              $10::jsonb,
              $11::jsonb,
              $12::jsonb,
              $13,
              $5::timestamptz
       from updated
       cross join cleared_children
       on conflict (run_id) do update
       set execution_attempt_id = excluded.execution_attempt_id,
           contract_version = excluded.contract_version,
           status = excluded.status,
           conclusion = excluded.conclusion,
           github_check_conclusion = excluded.github_check_conclusion,
           decision = excluded.decision,
           metrics = excluded.metrics,
           report_links = excluded.report_links,
           payload = excluded.payload,
           result_digest = excluded.result_digest,
           received_at = excluded.received_at,
           last_publication_attempt_at = null,
           github_check_published_at = null,
           github_comment_published_at = null,
           last_publication_error = null
       returning run_id
     ),
     persisted_audit as (
       insert into audit_events (
         installation_id,
         event_type,
         actor_type,
         actor_id,
         subject_type,
         subject_id,
         repository_id,
         release_run_id,
         metadata
       )
       select repositories.installation_id,
              'runner.result.persisted',
              'runner',
              $2,
              'release_run',
              updated.id,
              updated.repository_id,
              updated.id,
              jsonb_build_object(
                'contractVersion', $8,
                'status', $3,
                'conclusion', $9,
                'resultDigest', $13,
                'executionAttemptId', $2,
                'attemptUpdated', exists(select 1 from updated_attempt),
                'leaseCompleted', exists(select 1 from completed_lease),
                 'findingCount', (select count(*) from inserted_findings),
                'artifactCount', jsonb_array_length($14::jsonb),
                'artifactDeletionJobCount', (select count(*) from queued_artifact_deletions),
                'artifactDeletionSkippedCount', (select count(*) from skipped_artifact_deletion_audit),
                'metricCount', (select count(*) from jsonb_object_keys($10::jsonb)),
                'reportLinkCount', jsonb_array_length($11::jsonb)
              ) || $17::jsonb
       from updated
       join repositories on repositories.id = updated.repository_id
       join upserted_result on upserted_result.run_id = updated.id
       returning id
     )
     select effective.effective_outcome as persistence_outcome,
            effective.id,
            effective.github_check_run_id,
            effective.pull_request_number,
            repositories.owner,
            repositories.name,
            installations.github_installation_id,
            effective.trust_mode,
            effective.safe_mode_reasons,
            coalesce(updated.completed_at, effective.completed_at) as completed_at,
            (select count(*) from inserted_findings) as inserted_finding_count,
            (select count(*) from inserted_artifacts) as inserted_artifact_count,
            (select count(*) from updated_attempt) as updated_attempt_count,
            (select count(*) from persisted_audit) as persisted_audit_count
     from effective
     left join updated on updated.id = effective.id
     join repositories on repositories.id = effective.repository_id
     join installations on installations.id = repositories.installation_id`,
    [
      runId,
      executionAttemptId ?? null,
      parsed.data.status,
      parsed.data.decision,
      completedAt,
      findingsJson,
      terminalDigest,
      parsed.data.version,
      parsed.data.conclusion,
      metricsJson,
      reportLinksJson,
      payloadJson,
      digest,
      artifactsJson,
      dependencies.verifiedLeaseId ?? null,
      githubCheckConclusion,
      decisionAuditMetadataJson,
      artifactStorageDriver(dependencies),
    ],
  );
  const row = rows(updateResult)[0];

  if (!row) {
    return Response.json({ ok: false, error: "release run not found" }, { status: 404 });
  }

  const persistenceOutcome = stringCell(row, "persistence_outcome") ?? "accepted";

  if (persistenceOutcome === "superseded") {
    return Response.json({ ok: false, error: "release run was superseded by a newer commit", runId }, { status: 409 });
  }

  if (persistenceOutcome === "stale_attempt") {
    return Response.json(
      { ok: false, error: "execution attempt is no longer current", runId, executionAttemptId },
      { status: 409 },
    );
  }

  if (persistenceOutcome === "artifact_integrity_mismatch") {
    return Response.json(
      {
        ok: false,
        error: "runner artifact metadata does not match verified uploads",
        runId,
        executionAttemptId,
      },
      { status: 409 },
    );
  }

  if (persistenceOutcome === "conflicting_terminal_result") {
    return Response.json(
      { ok: false, error: "terminal result conflicts with the persisted result", runId, executionAttemptId },
      { status: 409 },
    );
  }

  if (persistenceOutcome === "invalid_transition") {
    return Response.json(
      { ok: false, error: "runner result is not valid for the current lifecycle state", runId, executionAttemptId },
      { status: 409 },
    );
  }

  const publicationCompletedAt = stringCell(row, "completed_at") ?? completedAt;
  const githubCheckRunId = numberLikeCell(row, "github_check_run_id");
  let checkRunUpdated = false;
  let pullRequestCommentCreated = false;
  const publicationWarnings: string[] = [];

  if (terminalStatus(parsed.data.status)) {
    const checkRunClient = dependencies.checkRunClient();
    const installationId = numberLikeCell(row, "github_installation_id");
    const repositoryOwner = stringCell(row, "owner");
    const repositoryName = stringCell(row, "name");
    const runDetailsUrl = dependencies.detailsUrl(runId);
    const trustSnapshot = publicationTrustSnapshot(row);
    const publicationInput = trustSnapshot
      ? { ...parsed.data, ...trustSnapshot, detailsUrl: runDetailsUrl }
      : undefined;
    const checkOutput = publicationInput ? buildReadinessCheckOutput(publicationInput) : undefined;
    const blockingPublicationErrors: string[] = [];
    let publicationConfigurationError = false;

    if (!trustSnapshot) {
      blockingPublicationErrors.push("Release-run trust snapshot is invalid");
      publicationConfigurationError = true;
    }

    if (githubCheckRunId && trustSnapshot && checkOutput) {
      if (!checkRunClient?.completeCheckRun || !installationId || !repositoryOwner || !repositoryName) {
        blockingPublicationErrors.push("GitHub check-run completion is not configured");
        publicationConfigurationError = true;
      } else {
        try {
          await checkRunClient.completeCheckRun({
            installationId,
            repositoryOwner,
            repositoryName,
            checkRunId: githubCheckRunId,
            runId,
            conclusion: checkConclusion(parsed.data),
            title: checkOutput.title,
            summary: checkOutput.summary,
            completedAt: publicationCompletedAt,
          });
          checkRunUpdated = true;
        } catch (error) {
          blockingPublicationErrors.push(`GitHub check run: ${publicationErrorMessage(error)}`);
        }
      }
    }

    const pullRequestNumber = numberCell(row, "pull_request_number");
    if (pullRequestNumber && trustSnapshot && publicationInput) {
      if (!checkRunClient?.createPullRequestComment || !installationId || !repositoryOwner || !repositoryName) {
        publicationWarnings.push("GitHub pull-request comment publication is not configured");
      } else {
        try {
          await checkRunClient.createPullRequestComment({
            installationId,
            repositoryOwner,
            repositoryName,
            pullRequestNumber,
            body: buildReadinessPrComment(publicationInput),
          });
          pullRequestCommentCreated = true;
        } catch (error) {
          publicationWarnings.push(`GitHub pull request comment: ${publicationErrorMessage(error)}`);
        }
      }
    }

    const publicationErrors = [...blockingPublicationErrors, ...publicationWarnings];
    await recordPublicationState(executor, {
      runId,
      completedAt: publicationCompletedAt,
      checkRunUpdated,
      pullRequestCommentCreated,
      errors: publicationErrors,
    });

    if (blockingPublicationErrors.length > 0) {
      return Response.json(
        {
          ok: false,
          persisted: true,
          error: "runner result was persisted but GitHub publication is incomplete",
          publicationErrors: blockingPublicationErrors,
          publicationWarnings,
          runId,
          executionAttemptId,
          checkRunUpdated,
          pullRequestCommentCreated,
        },
        { status: publicationConfigurationError ? 503 : 502 },
      );
    }
  }

  const responseStatus = persistenceOutcome === "replayed" ? "replayed" : "accepted";

  return Response.json(
    {
      ok: true,
      status: responseStatus,
      runId,
      executionAttemptId,
      checkRunUpdated,
      pullRequestCommentCreated,
      ...(publicationWarnings.length === 0 ? {} : { publicationWarnings }),
      result: parsed.data,
    },
    { status: responseStatus === "replayed" ? 200 : 202 },
  );
}

export async function POST(request: Request): Promise<Response> {
  return await handleResultRequest(request);
}
