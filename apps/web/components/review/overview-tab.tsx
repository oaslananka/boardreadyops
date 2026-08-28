import type { DemoReview } from "../../lib/demo-data.js";
import { Definition, DefinitionGrid, Panel, StatusBadge } from "../ui.js";

function getReadinessTone(decision: string, isReadyForFab: boolean): "danger" | "ready" | "blocked" {
  if (decision === "changes_requested") return "danger";
  return isReadyForFab ? "ready" : "blocked";
}

function getReadinessTitle(decision: string, isReadyForFab: boolean): string {
  if (decision === "changes_requested") return "Changes Requested — Fabrication Blocked";
  return isReadyForFab ? "Ready for Fabrication" : "Fabrication Gate Blocked";
}

function getReadinessDescription(
  decision: string,
  isReadyForFab: boolean,
  blockingCount: number,
  pendingChecklistCount: number,
): string {
  if (decision === "changes_requested") {
    return "A sign-off authority has requested changes. Hardware revision must be updated and approved.";
  }
  if (isReadyForFab) {
    return "All checklist items complete, no blocking findings, and evidence digest approved.";
  }
  return `${blockingCount} blocking finding(s), ${pendingChecklistCount} checklist item(s) pending.`;
}

export function OverviewTab({ review }: { readonly review: DemoReview }) {
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
    review.decision === "approved" &&
    blockingFindings.length === 0 &&
    completedChecklist.length === review.checklist.length &&
    validApprovals.length > 0;

  const readinessTone = getReadinessTone(review.decision, isReadyForFab);
  const readinessTitle = getReadinessTitle(review.decision, isReadyForFab);
  const pendingChecklistCount = review.checklist.length - completedChecklist.length;
  const readinessDescription = getReadinessDescription(
    review.decision,
    isReadyForFab,
    blockingFindings.length,
    pendingChecklistCount,
  );

  let changedFilesContent: React.ReactNode;
  if (review.changedFiles === undefined) {
    changedFilesContent = (
      <p className="no-items-message">Hardware surface diff details are not available for this persisted review.</p>
    );
  } else if (review.changedFiles.length === 0) {
    changedFilesContent = (
      <p className="no-items-message">No changed hardware surface files detected for this revision.</p>
    );
  } else {
    changedFilesContent = review.changedFiles.map((file) => (
      <div key={file.path} className="changed-file-row">
        <span className={`file-status-badge ${file.status}`}>{file.status}</span>
        <code className="file-path">{file.path}</code>
        <span className="changes-count">+{file.changesCount} lines</span>
      </div>
    ));
  }

  return (
    <div className="overview-tab-content">
      <section className={`decision-band readiness-band ${readinessTone}`}>
        <div className="readiness-lead">
          <h3>{readinessTitle}</h3>
          <p>{readinessDescription}</p>
        </div>
        <div className="metric-strip">
          <span className="metric-pill">
            <strong>{blockingFindings.length}</strong> blockers
          </span>
          <span className="metric-pill">
            <strong>{waivedFindings.length}</strong> waived
          </span>
          <span className="metric-pill">
            <strong>
              {completedChecklist.length}/{review.checklist.length}
            </strong>{" "}
            checklist
          </span>
          <span className="metric-pill">
            <strong>{validApprovals.length}</strong> approvals
          </span>
        </div>
      </section>

      <Panel title="Changed Hardware Surfaces" tone="default">
        <div className="changed-files-list">{changedFilesContent}</div>
      </Panel>

      <Panel title="Review Details & Metadata" tone="inset">
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
    </div>
  );
}
