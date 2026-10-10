import type { PolicyFieldSource } from "@boardreadyops/contracts";
import Link from "next/link";
import { customerStatusLabel } from "../../lib/customer-nomenclature.js";
import type { DemoReview } from "../../lib/demo-data.js";
import { Button } from "../ui/button.js";
import { Definition, DefinitionGrid, Panel, StatusBadge } from "../ui.js";

/**
 * Whether this revision has rendered schematic/PCB snapshots behind the Changes tab.
 *
 * The overview's file list reads as the whole of the hardware diff, so a reviewer who never
 * opened Changes had no reason to believe the product could show them the board at all. The
 * canvas (pan, zoom, base/head overlay, finding markers) has been there since run snapshots
 * shipped; this panel is where they find out.
 */
function hasCanvas(review: DemoReview): boolean {
  return (review.headSnapshots?.length ?? 0) > 0;
}

function canvasSummary(review: DemoReview): string {
  const head = review.headSnapshots?.length ?? 0;
  if (head === 0) {
    return "No rendered schematic or PCB snapshot was published for this revision, so the file list is the whole diff.";
  }
  const sheets = head === 1 ? "1 rendered sheet or layer" : `${head} rendered sheets and layers`;
  return (review.baseSnapshots?.length ?? 0) > 0
    ? `${sheets}, with the base revision available for side-by-side and overlay comparison.`
    : `${sheets} you can pan, zoom, and open findings on.`;
}

type ReadinessTone = "danger" | "success" | "warning";

function getReadinessTone(decision: string, reviewChecksMet: boolean): ReadinessTone {
  if (decision === "changes_requested") return "danger";
  return reviewChecksMet ? "success" : "warning";
}

function getReadinessTitle(decision: string, reviewChecksMet: boolean): string {
  if (decision === "changes_requested") return "Changes Requested — Review Blocked";
  return reviewChecksMet ? "Review Checks Met — Release Not Verified" : "Review Checks Incomplete";
}

function getReadinessDescription(
  decision: string,
  reviewChecksMet: boolean,
  blockingCount: number,
  pendingChecklistCount: number,
): string {
  if (decision === "changes_requested") {
    return "Changes have been requested on this Review. A new revision and explicit review decision are needed.";
  }
  if (reviewChecksMet) {
    return "The Review checklist, recorded blockers, and an approval matching this evidence digest meet the Review checks. This is not a verified manufacturing export, source-bound release, or fabrication authorization.";
  }
  return `${blockingCount} recorded blocking finding(s), ${pendingChecklistCount} checklist item(s) pending. No manufacturing authorization follows from this Review status.`;
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

function policySourceLabel(source: PolicyFieldSource | null): string {
  if (!source) return "Not configured";
  return `${customerStatusLabel(source.layer)} · ${source.policyName}`;
}

function policyValueWithSource(value: string, source: PolicyFieldSource | null) {
  return (
    <span>
      {value}
      <span className="block text-xs text-muted-foreground">Source: {policySourceLabel(source)}</span>
    </span>
  );
}

/**
 * Current Review revisions bind to repository-wide evidence runs, not to a specific
 * board in a multi-board repository. Source commit strings alone are not attestation.
 */
export function ReviewRevisionEvidence({ review }: Readonly<{ review: DemoReview }>) {
  const baseSha = /^0+$/u.test(review.baseCommitSha) ? undefined : review.baseCommitSha;
  return (
    <Panel
      title="Revision evidence trail"
      description="Compare the recorded source revisions and open their evidence runs when linked."
      tone="inset"
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase text-muted-foreground">Base revision</dt>
          <dd className="mt-1 break-all text-sm">
            <code>{baseSha ?? "Not recorded"}</code>
          </dd>
          <dd className="mt-1 text-sm">
            {review.baseRunId ? (
              <Link
                href={`/runs/${encodeURIComponent(review.baseRunId)}`}
                className="text-primary underline underline-offset-2"
              >
                Inspect linked base Run
              </Link>
            ) : (
              <span className="text-muted-foreground">No linked base Run for this Review revision</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase text-muted-foreground">Head revision</dt>
          <dd className="mt-1 break-all text-sm">
            <code>{review.headCommitSha}</code>
          </dd>
          <dd className="mt-1 text-sm">
            {review.headRunId ? (
              <Link
                href={`/runs/${encodeURIComponent(review.headRunId)}`}
                className="text-primary underline underline-offset-2"
              >
                Inspect linked head Run
              </Link>
            ) : (
              <span className="text-muted-foreground">No linked head Run available for this Review</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        These are the source commits recorded on this Review revision. A linked Run is execution evidence, not
        independent proof of a signed source-bound manufacturing package. The Review is repository-scoped: neither a Run
        link nor this comparison proves which individual boards were approved.
      </p>
    </Panel>
  );
}

export function OverviewTab({
  review,
  onOpenChanges,
}: {
  readonly review: DemoReview;
  /** Switches to the Changes tab, where the schematic and PCB canvas lives. */
  readonly onOpenChanges?: (() => void) | undefined;
}) {
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

  const reviewChecksMet =
    review.decision === "approved" &&
    review.evidenceState === "current" &&
    blockingFindings.length === 0 &&
    completedChecklist.length === review.checklist.length &&
    validApprovals.length > 0;

  const readinessTone = getReadinessTone(review.decision, reviewChecksMet);
  const readinessTitle = getReadinessTitle(review.decision, reviewChecksMet);
  const pendingChecklistCount = review.checklist.length - completedChecklist.length;
  const readinessDescription = getReadinessDescription(
    review.decision,
    reviewChecksMet,
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
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
          {customerStatusLabel(file.status)}
        </span>
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

      <ReviewRevisionEvidence review={review} />

      {review.effectivePolicy ? (
        <Panel
          title="Effective Policy & Inheritance"
          description="The release gate below is resolved from organization defaults plus any repository-level overrides. Each value names the policy layer that supplied it."
          tone="inset"
        >
          <DefinitionGrid>
            <Definition label="Baseline policy">{review.effectivePolicy.name}</Definition>
            <Definition label="Effective layer">{customerStatusLabel(review.effectivePolicy.sourceLayer)}</Definition>
            <Definition label="Severity gate">
              {policyValueWithSource(
                review.effectivePolicy.severityGate
                  ? customerStatusLabel(review.effectivePolicy.severityGate)
                  : "Not set",
                review.effectivePolicy.provenance.severityGate,
              )}
            </Definition>
            <Definition label="Required checklist">
              {policyValueWithSource(
                review.effectivePolicy.requiredChecklist.length > 0
                  ? review.effectivePolicy.requiredChecklist.join(", ")
                  : "None",
                review.effectivePolicy.provenance.requiredChecklist,
              )}
            </Definition>
            <Definition label="Required roles">
              {policyValueWithSource(
                review.effectivePolicy.requiredRoles.length > 0
                  ? review.effectivePolicy.requiredRoles.join(", ")
                  : "None",
                review.effectivePolicy.provenance.requiredRoles,
              )}
            </Definition>
            <Definition label="Evidence pack">
              {policyValueWithSource(
                review.effectivePolicy.requireEvidencePack ? "Required" : "Not required",
                review.effectivePolicy.provenance.requireEvidencePack,
              )}
            </Definition>
            <Definition label="External review">
              {policyValueWithSource(
                review.effectivePolicy.requireExternalReview ? "Required" : "Not required",
                review.effectivePolicy.provenance.requireExternalReview,
              )}
            </Definition>
          </DefinitionGrid>
        </Panel>
      ) : null}

      <Panel
        title="Changed Hardware Surfaces"
        description={canvasSummary(review)}
        tone="default"
        actions={
          onOpenChanges ? (
            <Button type="button" size="sm" variant="outline" onClick={onOpenChanges}>
              {hasCanvas(review) ? "Open the visual diff" : "Open Changes"}
            </Button>
          ) : undefined
        }
      >
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
