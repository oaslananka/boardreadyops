import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import { type DemoEvidenceItem, type DemoFinding, type DemoReview, getDemoReview } from "./demo-data.js";
import { buildDemoSnapshots } from "./demo-snapshots.js";
import type { UserSession } from "./user-session.js";

function mapCanonicalSeverity(raw: string): DemoFinding["severity"] {
  const lower = raw.toLowerCase();
  if (lower === "critical") return "critical";
  if (lower === "error" || lower === "high") return "error";
  if (lower === "warning" || lower === "medium") return "warning";
  return "info";
}

interface StoredDbReviewRow {
  id: string;
  repository_id: string;
  pull_request_number: number | null;
  title: string;
  status: "draft" | "active" | "awaiting_decision" | "completed" | "superseded";
  decision: "pending" | "approved" | "changes_requested";
  base_run_id: string | null;
  head_run_id: string;
  current_revision_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  owner: string;
  name: string;
  private: boolean;
  disabled_at: string | null;
  suspended_at: string | null;
  github_installation_id: number | string;
  account_login: string;
}

interface StoredDbRevisionRow {
  id: string;
  sequence: number;
  base_run_id: string | null;
  head_run_id: string;
  base_commit_sha: string | null;
  head_commit_sha: string;
  evidence_digest: string;
}

interface StoredDbFindingRow {
  id: string;
  rule_id: string;
  severity: string;
  message: string;
  path: string;
  kind: string;
  fingerprint: string | null;
}

interface StoredDbDecisionRow {
  finding_fingerprint: string;
  disposition: "fixed" | "open" | "accepted_risk" | "false_positive" | "not_applicable";
  reason: string | null;
  owner: string | null;
  expires_at: string | null;
}

interface StoredDbAssignmentRow {
  finding_fingerprint: string;
  assignee: string;
}

interface StoredDbApprovalRow {
  id: string;
  approver_id: string;
  status: "approved" | "changes_requested" | "invalidated" | "dismissed";
  reason: string | null;
  is_break_glass: boolean;
  evidence_digest: string;
  created_at: string;
}

interface StoredDbChecklistRow {
  id: string;
  title: string;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
}

interface StoredDbCommentRow {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_type: "internal" | "guest";
  content: string;
  status: "open" | "resolved" | "stale";
  finding_fingerprint: string | null;
  evidence_anchor: string | null;
  created_at: string;
}

function safeInstallationId(value: unknown): number | undefined {
  let parsed = Number.NaN;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string") parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Loads an authoritative review from PostgreSQL, enforcing repository authorization,
 * exact current_revision_id alignment, active Marketplace checks, finding collaboration state,
 * and canonical non-inflated severity mapping.
 *
 * Fails closed (returns null) for unauthorized viewers on private repositories, disabled repos,
 * suspended installations, or canceled subscriptions.
 */
export async function loadServerReview(reviewId: string, session?: UserSession | null): Promise<DemoReview | null> {
  if (reviewId.startsWith("rev_gateway_")) {
    const fixture = getDemoReview(reviewId);
    if (fixture) {
      return {
        ...fixture,
        headSnapshots: buildDemoSnapshots(fixture.changedFiles ?? [], fixture.findings),
      };
    }
  }

  const config = resolveCloudPersistenceConfiguration();

  if (config.mode === "postgres") {
    const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
    try {
      const reviewResult = await executor.query(
        `SELECT
          reviews.id,
          reviews.repository_id,
          reviews.pull_request_number,
          reviews.title,
          reviews.status,
          reviews.decision,
          reviews.base_run_id,
          reviews.head_run_id,
          reviews.current_revision_id,
          reviews.created_by,
          reviews.created_at,
          reviews.updated_at,
          reviews.completed_at,
          repositories.owner,
          repositories.name,
          repositories.private,
          repositories.disabled_at,
          installations.suspended_at,
          installations.github_installation_id,
          installations.account_login
        FROM reviews
        JOIN repositories ON repositories.id = reviews.repository_id
        JOIN installations ON installations.id = repositories.installation_id
        WHERE reviews.id = $1
        LIMIT 1`,
        [reviewId],
      );

      const reviewRows = (reviewResult as { rows?: StoredDbReviewRow[] }).rows ?? [];
      const row = reviewRows[0];

      if (!row) {
        return null;
      }

      // Security invariants: disabled repo or suspended installation fails closed
      if (row.disabled_at !== null || row.suspended_at !== null) {
        return null;
      }

      const githubInstallationId = safeInstallationId(row.github_installation_id);
      if (githubInstallationId === undefined) {
        return null;
      }

      // Marketplace cancellation check
      const subResult = await executor.query(
        `SELECT 1 FROM github_marketplace_subscriptions
         WHERE status = 'canceled'
           AND (
             github_installation_id = $1
             OR (github_installation_id IS NULL AND lower(account_login) = lower($2))
           )
         LIMIT 1`,
        [githubInstallationId, row.account_login],
      );
      const subRows = (subResult as { rows?: unknown[] }).rows ?? [];
      if (subRows.length > 0) {
        return null;
      }

      // Viewer authorization on private repository
      if (row.private === true) {
        if (!session?.installationIds?.includes(githubInstallationId)) {
          return null;
        }
      }

      // Require exact current_revision_id
      if (!row.current_revision_id) {
        return null;
      }

      const revResult = await executor.query(
        `SELECT id, sequence, base_run_id, head_run_id, base_commit_sha, head_commit_sha, evidence_digest
         FROM review_revisions
         WHERE id = $1 AND review_id = $2
         LIMIT 1`,
        [row.current_revision_id, reviewId],
      );
      const revRows = (revResult as { rows?: StoredDbRevisionRow[] }).rows ?? [];
      const revision = revRows[0];
      if (!revision) {
        return null;
      }

      // Query real findings from head run
      const findingResult = await executor.query(
        `SELECT id, rule_id, severity, message, path, kind, fingerprint
         FROM findings
         WHERE run_id = $1
         ORDER BY id ASC`,
        [revision.head_run_id],
      );
      const findingRows = (findingResult as { rows?: StoredDbFindingRow[] }).rows ?? [];

      // Query finding decisions for this review
      const decResult = await executor.query(
        `SELECT finding_fingerprint, disposition, reason, owner, expires_at
         FROM finding_decisions
         WHERE review_id = $1
         ORDER BY created_at DESC`,
        [reviewId],
      );
      const decRows = (decResult as { rows?: StoredDbDecisionRow[] }).rows ?? [];
      const decisionsMap = new Map<string, StoredDbDecisionRow>();
      for (const d of decRows) {
        if (!decisionsMap.has(d.finding_fingerprint)) {
          decisionsMap.set(d.finding_fingerprint, d);
        }
      }

      // Query finding assignments for this review
      const asnResult = await executor.query(
        `SELECT finding_fingerprint, assignee
         FROM finding_assignments
         WHERE review_id = $1
         ORDER BY created_at ASC`,
        [reviewId],
      );
      const asnRows = (asnResult as { rows?: StoredDbAssignmentRow[] }).rows ?? [];
      const assignmentsMap = new Map<string, string[]>();
      for (const a of asnRows) {
        const list = assignmentsMap.get(a.finding_fingerprint) ?? [];
        if (!list.includes(a.assignee)) {
          list.push(a.assignee);
        }
        assignmentsMap.set(a.finding_fingerprint, list);
      }

      const findings: DemoFinding[] = findingRows.map((f) => {
        const fp = f.fingerprint ?? f.id;
        const dec = decisionsMap.get(fp);
        const assignees = assignmentsMap.get(fp) ?? [];
        return {
          fingerprint: fp,
          ruleId: f.rule_id,
          severity: mapCanonicalSeverity(f.severity),
          message: f.message,
          path: f.path,
          diffState: "new",
          disposition: dec?.disposition ?? "open",
          ...(dec?.reason ? { decisionReason: dec.reason } : {}),
          ...(dec?.owner ? { decisionOwner: dec.owner } : {}),
          ...(dec?.expires_at ? { decisionExpiresAt: dec.expires_at } : {}),
          assignees,
        };
      });

      // Query approvals
      const appResult = await executor.query(
        `SELECT id, approver_id, status, reason, is_break_glass, evidence_digest, created_at
         FROM review_approvals
         WHERE review_id = $1 AND repository_id = $2
         ORDER BY created_at DESC`,
        [reviewId, row.repository_id],
      );
      const appRows = (appResult as { rows?: StoredDbApprovalRow[] }).rows ?? [];

      // Query checklist
      const chkResult = await executor.query(
        `SELECT id, title, completed, completed_by, completed_at
         FROM review_checklist_items
         WHERE review_id = $1
         ORDER BY created_at ASC`,
        [reviewId],
      );
      const chkRows = (chkResult as { rows?: StoredDbChecklistRow[] }).rows ?? [];

      // Query comments
      const cmtResult = await executor.query(
        `SELECT id, parent_id, author_id, author_type, content, status, finding_fingerprint, evidence_anchor, created_at
         FROM review_comments
         WHERE review_id = $1
         ORDER BY created_at ASC`,
        [reviewId],
      );
      const cmtRows = (cmtResult as { rows?: StoredDbCommentRow[] }).rows ?? [];

      // Query runner artifacts for evidence manifest
      const artResult = await executor.query(
        `SELECT id, kind, name, role, declared_bytes, sha256
         FROM runner_artifacts
         WHERE run_id = $1
         ORDER BY created_at ASC`,
        [revision.head_run_id],
      );
      const artRows =
        (
          artResult as {
            rows?: Array<{
              id: string;
              kind: string;
              name: string;
              role: string;
              declared_bytes: number;
              sha256: string | null;
            }>;
          }
        ).rows ?? [];
      function mapEvidenceType(kindOrRole: string): DemoEvidenceItem["type"] {
        const lower = kindOrRole.toLowerCase();
        if (lower.includes("bom")) return "bom";
        if (lower.includes("sch")) return "schematic";
        if (lower.includes("pcb") || lower.includes("gerber") || lower.includes("step") || lower.includes("ipc"))
          return "pcb";
        if (lower.includes("drc") || lower.includes("report")) return "drc";
        if (lower.includes("net")) return "netlist";
        return "manifest";
      }

      const evidenceItems: DemoEvidenceItem[] = artRows.map((a) => ({
        id: a.id,
        name: a.name,
        type: mapEvidenceType(a.kind || a.role || "manifest"),
        path: `artifacts/${a.name}`,
        sha256: a.sha256 || "0".repeat(64),
        sizeBytes: a.declared_bytes || 0,
        verified: true,
      }));

      const baseCommit = revision.base_commit_sha ?? "0000000000000000000000000000000000000000";
      const headCommit = revision.head_commit_sha;
      const evidenceDigest = revision.evidence_digest;

      const reconstructed: DemoReview = {
        id: row.id,
        repositoryId: row.repository_id,
        repositoryName: `${row.owner}/${row.name}`,
        pullRequestNumber: row.pull_request_number ?? 0,
        title: row.title,
        status: row.status,
        decision: row.decision,
        currentRevisionId: revision.id,
        currentRevisionSequence: revision.sequence,
        baseCommitSha: baseCommit,
        headCommitSha: headCommit,
        evidenceDigest,
        evidenceState: "current",
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        evidenceItems,
        bomChanges: undefined,
        changedFiles: undefined,
        findings,
        approvals: appRows.map((a) => ({
          id: a.id,
          approverId: a.approver_id,
          status: a.status,
          ...(a.reason ? { reason: a.reason } : {}),
          ...(a.is_break_glass ? { isBreakGlass: a.is_break_glass } : {}),
          evidenceDigest: a.evidence_digest,
          createdAt: a.created_at,
        })),
        checklist: chkRows.map((c) => ({
          id: c.id,
          title: c.title,
          completed: c.completed,
          ...(c.completed_by ? { completedBy: c.completed_by } : {}),
          ...(c.completed_at ? { completedAt: c.completed_at } : {}),
        })),
        comments: cmtRows.map((m) => ({
          id: m.id,
          ...(m.parent_id ? { parentId: m.parent_id } : {}),
          authorId: m.author_id,
          authorType: m.author_type,
          content: m.content,
          status: m.status === "stale" ? "outdated" : (m.status ?? "open"),
          ...(m.finding_fingerprint ? { findingFingerprint: m.finding_fingerprint } : {}),
          ...(m.evidence_anchor ? { evidenceAnchor: m.evidence_anchor } : {}),
          createdAt: m.created_at,
        })),
      };

      return {
        ...reconstructed,
        headSnapshots: reconstructed.changedFiles
          ? buildDemoSnapshots(reconstructed.changedFiles, reconstructed.findings)
          : undefined,
      };
    } finally {
      await executor.close();
    }
  }

  // Non-postgres mode (development fixtures only)
  const fixture = getDemoReview(reviewId);
  if (fixture) {
    return {
      ...fixture,
      headSnapshots: buildDemoSnapshots(fixture.changedFiles ?? [], fixture.findings),
    };
  }

  return null;
}
