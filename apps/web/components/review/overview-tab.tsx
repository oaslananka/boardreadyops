import type { DemoReview } from "../../lib/demo-data.js";
import { Definition, DefinitionGrid, Panel, StatusBadge } from "../ui.js";

export function OverviewTab({ review }: { review: DemoReview }) {
  const blockingFindings = review.findings.filter(
    (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
  );
  const waivedFindings = review.findings.filter(
    (f) => f.disposition === "accepted_risk" || f.disposition === "false_positive",
  );
  const completedChecklist = review.checklist.filter((c) => c.completed);
  const validApprovals = review.approvals.filter(
    (a) => a.status === "approved" && a.evidenceDigest === review.evidenceDigest,
  );

  const isReadyForFab =
    blockingFindings.length === 0 && completedChecklist.length === review.checklist.length && validApprovals.length > 0;

  return (
    <div className="overview-tab-content">
      <div className="readiness-summary-cards">
        <div className={`readiness-card ${isReadyForFab ? "ready" : "blocked"}`}>
          <div className="readiness-card-icon">{isReadyForFab ? "✓" : "!"}</div>
          <div className="readiness-card-text">
            <h3>{isReadyForFab ? "Ready for Fabrication" : "Fabrication Gate Blocked"}</h3>
            <p>
              {isReadyForFab
                ? "All checklist items complete, no blocking findings, and evidence digest approved."
                : `${blockingFindings.length} blocking finding(s), ${review.checklist.length - completedChecklist.length} checklist item(s) pending.`}
            </p>
          </div>
        </div>

        <div className="metrics-grid">
          <div className="metric-box">
            <span className="metric-value">{blockingFindings.length}</span>
            <span className="metric-label">Blocking Errors</span>
          </div>
          <div className="metric-box">
            <span className="metric-value">{waivedFindings.length}</span>
            <span className="metric-label">Waived / Accepted</span>
          </div>
          <div className="metric-box">
            <span className="metric-value">
              {completedChecklist.length}/{review.checklist.length}
            </span>
            <span className="metric-label">Checklist Done</span>
          </div>
          <div className="metric-box">
            <span className="metric-value">{validApprovals.length}</span>
            <span className="metric-label">Approvals</span>
          </div>
        </div>
      </div>

      <Panel title="Review Details & Metadata">
        <DefinitionGrid>
          <Definition label="Repository">{review.repositoryName}</Definition>
          <Definition label="Author">{review.createdBy}</Definition>
          <Definition label="Base Commit">
            <code>{review.baseCommitSha}</code>
          </Definition>
          <Definition label="Head Commit">
            <code>{review.headCommitSha}</code>
          </Definition>
          <Definition label="Evidence Digest">
            <code className="text-break">{review.evidenceDigest}</code>
          </Definition>
          <Definition label="Evidence Status">
            <StatusBadge value={review.evidenceState === "current" ? "pass" : "warning"} label={review.evidenceState} />
          </Definition>
        </DefinitionGrid>
      </Panel>

      <Panel title="Changed Hardware Surfaces">
        <div className="changed-files-list">
          {review.changedFiles.map((file) => (
            <div key={file.path} className="changed-file-row">
              <span className={`file-status-badge ${file.status}`}>{file.status}</span>
              <code className="file-path">{file.path}</code>
              <span className="changes-count">+{file.changesCount} lines</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
