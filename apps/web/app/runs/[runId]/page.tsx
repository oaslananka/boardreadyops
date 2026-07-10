import { notFound } from "next/navigation";
import { formatArtifactBytes, formatRunDate, formatRunDuration, loadRunDashboard } from "../../../lib/run-dashboard";

export const dynamic = "force-dynamic";

type RunPageProps = {
  params: Promise<{ runId: string }>;
};

function StatusPill({ value }: { value: string | undefined }) {
  return <span className="badge">{value ?? "unknown"}</span>;
}

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;
  const result = await loadRunDashboard(runId);

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
            <dd>{formatRunDate(run.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatRunDate(run.completedAt)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatRunDuration(run.durationMs)}</dd>
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
            {run.findings.map((finding) => (
              <li key={`${finding.ruleId}:${finding.path ?? ""}:${finding.message}`}>
                <div>
                  <strong>{finding.ruleId}</strong> <StatusPill value={finding.severity} />
                </div>
                <p>{finding.message}</p>
                {finding.path ? <code>{finding.path}</code> : null}
                {finding.kind ? <p>Kind: {finding.kind}</p> : null}
                {finding.waivedAt ? <p>Waived at {formatRunDate(finding.waivedAt)}</p> : null}
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
                  {artifact.kind} · {formatArtifactBytes(artifact.bytes)} · uploaded{" "}
                  {formatRunDate(artifact.uploadedAt)}
                </p>
                <p>
                  SHA-256: <code>{artifact.sha256}</code>
                </p>
                {artifact.downloadUrl ? (
                  <p>
                    <a href={artifact.downloadUrl}>Download artifact</a>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
