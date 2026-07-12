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
            <dt>Conclusion</dt>
            <dd>
              <StatusPill value={run.conclusion} />
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
            <dt>Result contract</dt>
            <dd>{run.resultContractVersion ? `v${run.resultContractVersion}` : "—"}</dd>
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
        <h2>Execution attempts</h2>
        {run.attempts.length === 0 ? (
          <p>No execution attempt has been assigned to this run.</p>
        ) : (
          <ol className="stack-list">
            {run.attempts.map((attempt) => (
              <li key={attempt.id}>
                <div>
                  <strong>Attempt {attempt.attemptNumber}</strong> <StatusPill value={attempt.status} />
                </div>
                <p>
                  Requested {formatRunDate(attempt.dispatchRequestedAt ?? attempt.createdAt)} · dispatched{" "}
                  {formatRunDate(attempt.dispatchedAt)} · completed {formatRunDate(attempt.completedAt)}
                </p>
                {attempt.workflowDispatchId ? (
                  <p>
                    Workflow dispatch: <code>{attempt.workflowDispatchId}</code>
                  </p>
                ) : null}
                {attempt.failureClass || attempt.failureMessage ? (
                  <p role="alert">
                    {attempt.failureClass ? `${attempt.failureClass}: ` : ""}
                    {attempt.failureMessage ?? "Attempt failed."}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <h2>Publication</h2>
        <dl className="grid-list">
          <div>
            <dt>Last attempt</dt>
            <dd>{formatRunDate(run.lastPublicationAttemptAt)}</dd>
          </div>
          <div>
            <dt>GitHub check</dt>
            <dd>{formatRunDate(run.githubCheckPublishedAt)}</dd>
          </div>
          <div>
            <dt>PR comment</dt>
            <dd>{formatRunDate(run.githubCommentPublishedAt)}</dd>
          </div>
        </dl>
        {run.lastPublicationError ? <p role="alert">Last publication error: {run.lastPublicationError}</p> : null}
      </section>

      <section className="panel">
        <h2>Metrics and reports</h2>
        {Object.keys(run.metrics).length === 0 ? (
          <p>No metrics were reported for this run.</p>
        ) : (
          <dl className="grid-list">
            {Object.entries(run.metrics)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        )}
        {run.reportLinks.length === 0 ? (
          <p>No report links were attached to this run.</p>
        ) : (
          <ul className="stack-list">
            {run.reportLinks.map((report) => (
              <li key={`${report.label}:${report.url}`}>
                <a href={report.url}>{report.label}</a>
              </li>
            ))}
          </ul>
        )}
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
