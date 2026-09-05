import type { DemoReview } from "../../lib/demo-data.js";
import { Definition, DefinitionGrid, Panel, StatusBadge } from "../ui.js";

type ReadinessTone = "danger" | "success" | "warning";

function getReadinessTone(decision: string, isReadyForFab: boolean): ReadinessTone {
  if (decision === "changes_requested") return "danger";
  return isReadyForFab ? "success" : "warning";
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

const readinessBandClass: Record<"danger" | "success" | "warning", string> = {
  danger: "border-danger/40 bg-danger-surface",
  success: "border-success/40 bg-success-surface",
  warning: "border-warning/40 bg-warning-surface",
};

const readinessTextClass: Record<"danger" | "success" | "warning", string> = {
  danger: "text-danger",
  success: "text-success",
  warning: "text-warning",
};

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
      <p className="text-sm text-muted-foreground">
        Hardware surface diff details are not available for this persisted review.
      </p>
    );
  } else if (review.changedFiles.length === 0) {
    changedFilesContent = (
      <p className="text-sm text-muted-foreground">No changed hardware surface files detected for this revision.</p>
    );
  } else {
    changedFilesContent = review.changedFiles.map((file) => (
      <div key={file.path} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-b-0">
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{file.status}</span>
        <code className="flex-1 truncate">{file.path}</code>
        <span className="text-muted-foreground">+{file.changesCount} lines</span>
      </div>
    ));
  }

  return (
    <div className="flex flex-col gap-5">
      <section className={`rounded-md border p-4 ${readinessBandClass[readinessTone]}`}>
        <h3 className={`text-base font-bold ${readinessTextClass[readinessTone]}`}>{readinessTitle}</h3>
        <p className="mt-1 text-sm text-foreground">{readinessDescription}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span>
            <strong>{blockingFindings.length}</strong> blockers
          </span>
          <span>
            <strong>{waivedFindings.length}</strong> waived
          </span>
          <span>
            <strong>
              {completedChecklist.length}/{review.checklist.length}
            </strong>{" "}
            checklist
          </span>
          <span>
            <strong>{validApprovals.length}</strong> approvals
          </span>
        </div>
      </section>

      <Panel title="Changed Hardware Surfaces" tone="default">
        <div>{changedFilesContent}</div>
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
            <code className="break-all">{review.evidenceDigest}</code>
          </Definition>
          <Definition label="Evidence Status">
            <StatusBadge value={review.evidenceState === "current" ? "pass" : "warning"} label={review.evidenceState} />
          </Definition>
        </DefinitionGrid>
      </Panel>
    </div>
  );
}
