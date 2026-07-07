import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type RunPageProps = {
  params: Promise<{ runId: string }>;
};

type QueryResult = {
  rows?: readonly Record<string, unknown>[];
};

type RunDetail = {
  id: string;
  status: string;
  decision?: string;
  commitSha: string;
  ref: string;
  pullRequestNumber?: number;
  triggerKind: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  boardReadyOpsVersion?: string;
  kicadVersion?: string;
  githubCheckRunId?: string;
  readinessScore?: number;
  repository: string;
  accountLogin?: string;
  findings: FindingDetail[];
  artifacts: ArtifactDetail[];
};

type FindingDetail = {
  ruleId: string;
  severity: string;
  message: string;
  path?: string;
  kind?: string;
  waivedAt?: string;
};

type ArtifactDetail = {
  kind: string;
  name: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  role: string;
  uploadedAt: string;
};

type RunLookupResult =
  | { state: "not-configured" }
  | { state: "not-found" }
  | { state: "found"; run: RunDetail };

const severityRank: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    return [];
  }

  const value = (result as QueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringValue(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  return stringValue(row, key) ?? "";
}

function formatDate(input?: string): string {
  if (!input) {
    return "—";
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? input : date.toISOString();
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) {
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function bySeverityThenRule(a: FindingDetail, b: FindingDetail): number {
  const rank = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
  return rank === 0 ? a.ruleId.localeCompare(b.ruleId) : rank;
}

async function lookupRun(runId: string): Promise<RunLookupResult> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return { state: "not-configured" };
  }

  const executor = createPgQueryExecutor({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });

  const runResult = await executor.query(
    `select
       release_runs.id,
       release_runs.status,
       release_runs.decision,
       release_runs.commit_sha,
       release_runs.ref,
       release_runs.pull_request_number,
       release_runs.trigger_kind,
       release_runs.started_at,
       release_runs.completed_at,
       release_runs.duration_ms,
       release_runs.board_ready_ops_version,
       release_runs.kicad_version,
       release_runs.github_check_run_id,
       release_runs.readiness_score,
       repositories.owner,
       repositories.name,
       installations.account_login
     from release_runs
     join repositories on repositories.id = release_runs.repository_id
     join installations on installations.id = repositories.installation_id
     where release_runs.id = $1`,
    [runId],
  );
  const runRow = rows(runResult)[0];

  if (!runRow) {
    return { state: "not-found" };
  }

  const findingsResult = await executor.query(
    `select rule_id, severity, message, path, kind, waived_at
     from findings
     where run_id = $1`,
    [runId],
  );

  const artifactsResult = await executor.query(
    `select kind, name, storage_path, sha256, bytes, role, uploaded_at
     from artifacts
     where run_id = $1
     order by uploaded_at desc`,
    [runId],
  );

  const findings = rows(findingsResult)
    .map((row): FindingDetail => ({
      ruleId: requiredString(row, "rule_id"),
      severity: requiredString(row, "severity"),
      message: requiredString(row, "message"),
      path: stringValue(row, "path"),
      kind: stringValue(row, "kind"),
      waivedAt: stringValue(row, "waived_at"),
    }))
    .sort(bySeverityThenRule);

  const artifacts = rows(artifactsResult).map(
    (row): ArtifactDetail => ({
      kind: requiredString(row, "kind"),
      name: requiredString(row, "name"),
      storagePath: requiredString(row, "storage_path"),
      sha256: requiredString(row, "sha256"),
      bytes: numberValue(row, "bytes") ?? 0,
      role: requiredString(row, "role"),
      uploadedAt: requiredString(row, "uploaded_at"),
    }),
  );

  return {
    state: "found",
    run: {
      id: requiredString(runRow, "id"),
      status: requiredString(runRow, "status"),
      decision: stringValue(runRow, "decision"),
      commitSha: requiredString(runRow, "commit_sha"),
      ref: requiredString(runRow, "ref"),
      pullRequestNumber: numberValue(runRow, "pull_request_number"),
      triggerKind: requiredString(runRow, "trigger_kind"),
      startedAt: requiredString(runRow, "started_at"),
      completedAt: stringValue(runRow, "completed_at"),
      durationMs: numberValue(runRow, "duration_ms"),
      boardReadyOpsVersion: stringValue(runRow, "board_ready_ops_version"),
      kicadVersion: stringValue(runRow, "kicad_version"),
      githubCheckRunId: stringValue(runRow, "github_check_run_id"),
      readinessScore: numberValue(runRow, "readiness_score"),
      repository: `${requiredString(runRow, "owner")}/${requiredString(runRow, "name")}`,
      accountLogin: stringValue(runRow, "account_login"),
      findings,
      artifacts,
    },
  };
}

function StatusPill({ value }: { value?: string }) {
  return <span className="badge">{value ?? "unknown"}</span>;
}

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;
  const result = await lookupRun(runId);

  if (result.state === "not-found") {
    notFound();
  }

  if (result.state === "not-configured") {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">Release readiness run</p>
          <h1>BoardReadyOps run</h1>
          <p className="lede">The run dashboard is available when the hosted app is connected to the cloud database.</p>
        </section>
        <section className="panel">
          <h2>Run status</h2>
          <p>
            <strong>Run ID:</strong> <code>{runId}</code>
          </p>
          <p>The database connection is not configured for this deployment.</p>
        </section>
      </main>
    );
  }

  const { run } = result;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Release readiness run</p>
        <h1>BoardReadyOps run</h1>
        <p className="lede">Review the GitHub App readiness decision, findings, and generated release artifacts.</p>
      </section>

      <section className="panel">
        <h2>Run summary</h2>
        <dl className="grid-list">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusPill value={run.status} />
            </dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>
              <StatusPill value={run.decision} />
            </dd>
          </div>
          <div>
            <dt>Repository</dt>
            <dd>{run.repository}</dd>
          </div>
          <div>
            <dt>Trigger</dt>
            <dd>{run.triggerKind}</dd>
          </div>
          <div>
            <dt>Pull request</dt>
            <dd>{run.pullRequestNumber ? `#${run.pullRequestNumber}` : "—"}</dd>
          </div>
          <div>
            <dt>Readiness score</dt>
            <dd>{run.readinessScore ?? "—"}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatDate(run.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatDate(run.completedAt)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(run.durationMs)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Source</h2>
        <dl className="grid-list">
          <div>
            <dt>Run ID</dt>
            <dd>
              <code>{run.id}</code>
            </dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>
              <code>{run.commitSha}</code>
            </dd>
          </div>
          <div>
            <dt>Ref</dt>
            <dd>
              <code>{run.ref}</code>
            </dd>
          </div>
          <div>
            <dt>Check run</dt>
            <dd>{run.githubCheckRunId ? <code>{run.githubCheckRunId}</code> : "—"}</dd>
          </div>
          <div>
            <dt>BoardReadyOps</dt>
            <dd>{run.boardReadyOpsVersion ?? "—"}</dd>
          </div>
          <div>
            <dt>KiCad</dt>
            <dd>{run.kicadVersion ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Findings</h2>
        {run.findings.length === 0 ? (
          <p>No findings were reported for this run.</p>
        ) : (
          <ul className="stack-list">
            {run.findings.map((finding, index) => (
              <li key={`${finding.ruleId}-${index}`}>
                <div>
                  <strong>{finding.ruleId}</strong> <StatusPill value={finding.severity} />
                </div>
                <p>{finding.message}</p>
                {finding.path ? <code>{finding.path}</code> : null}
                {finding.waivedAt ? <p>Waived at {formatDate(finding.waivedAt)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Artifacts</h2>
        {run.artifacts.length === 0 ? (
          <p>No artifacts were attached to this run yet.</p>
        ) : (
          <ul className="stack-list">
            {run.artifacts.map((artifact) => (
              <li key={`${artifact.kind}-${artifact.name}-${artifact.sha256}`}>
                <div>
                  <strong>{artifact.name}</strong> <StatusPill value={artifact.role} />
                </div>
                <p>
                  {artifact.kind} · {formatBytes(artifact.bytes)} · uploaded {formatDate(artifact.uploadedAt)}
                </p>
                <p>
                  <code>{artifact.storagePath}</code>
                </p>
                <p>
                  SHA-256: <code>{artifact.sha256}</code>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
