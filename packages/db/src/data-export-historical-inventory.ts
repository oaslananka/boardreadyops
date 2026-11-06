import { createHash } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";
import type { PgQueryExecutor } from "./pg-executor.js";

const maxRepositories = 100;
const maxBytes = 256 * 1024;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);

export class HistoricalUserInventoryUnavailableError extends Error {
  constructor() {
    super("Historical user export inventory could not be completely and safely bounded.");
    this.name = "HistoricalUserInventoryUnavailableError";
  }
}

// Shared, immutable account authority: do not drift between independent
// historical preflights. Never infer ownership from a recycled login alone.
const historicalOwnerCtes = `owner_export AS MATERIALIZED (
          SELECT exports.id, exports.tenant_id, exports.original_github_user_id
            FROM data_exports AS exports
           WHERE exports.id=$1
             AND exports.original_github_user_id=$2::bigint
             AND exports.scope='user'
             AND exports.installation_id IS NULL
             AND exports.requested_by='github_app_uninstall'
             AND exports.status='pending'
             AND (exports.expires_at IS NULL OR exports.expires_at>clock_timestamp())
             AND lower(exports.scope_id)=lower(exports.tenant_id)
             -- This source snapshot is private but still contains opaque
             -- owner data. A revoked/expired request, any active tenant
             -- legal hold, or any non-dry-run erasure in progress must
             -- fail BEFORE even the earliest inventory read. Publication
             -- still requires independent locked reauthorization.
             AND NOT EXISTS (
               SELECT 1 FROM legal_holds AS hold
                WHERE lower(hold.tenant_id)=lower(exports.tenant_id)
                  AND hold.active=TRUE
             )
             AND NOT EXISTS (
               SELECT 1 FROM erasure_requests AS erasure
                WHERE lower(erasure.tenant_id)=lower(exports.tenant_id)
                  AND erasure.status IN ('running','completed')
                  AND erasure.dry_run=FALSE
             )
        ), former_installations AS MATERIALIZED (
          SELECT installations.id
            FROM installations
            JOIN owner_export ON installations.account_user_id=owner_export.original_github_user_id
                             AND lower(installations.account_login)=lower(owner_export.tenant_id)
           WHERE lower(installations.account_type)='user'
             AND installations.suspended_at IS NOT NULL
        )`;

type HistoricalRepository = {
  repositoryId: string;
  githubRepositoryId: string;
  owner: string;
  name: string;
  private: boolean;
  disabled: boolean;
};

function validRepository(value: unknown): value is HistoricalRepository {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    isUuid(item.repositoryId) &&
    typeof item.githubRepositoryId === "string" &&
    /^\d{1,20}$/u.test(item.githubRepositoryId) &&
    typeof item.owner === "string" &&
    item.owner.length > 0 &&
    item.owner.length <= 128 &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    item.name.length <= 128 &&
    typeof item.private === "boolean" &&
    typeof item.disabled === "boolean"
  );
}

/**
 * INTERNAL read-only historical USER repository discovery: *not* an archive,
 * not proof of full export coverage, and never exposed as an HTTP response.
 *
 * Original ownership is bound to the numeric GitHub account ID carried by
 * the signed installation webhook at uninstall. A matching/recycled login,
 * existing/previous installation session or arbitrary export ID is not enough.
 * Only retained repositories of SAME owner-ID, originally associated with
 * that user-scoped tenant and currently suspended installations are included.
 * All other classes (runs, artifacts, reviews, platform storage) remain
 * explicitly absent and must be handled in future claim-bound materialization.
 */
export async function prepareVerifiedHistoricalUserRepositoryInventory(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<{ bytes: Buffer; sha256: string; byteLength: number; repositoryCount: number } | null> {
  if (
    !db?.withTransaction ||
    !isUuid(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;

  return db.withTransaction(
    async (tx) => {
      const query = await tx.query(
        `WITH ${historicalOwnerCtes}, bounded_repositories AS (
          SELECT repositories.id, repositories.github_repo_id::text AS github_repo_id,
                 repositories.owner, repositories.name, repositories.private,
                 (repositories.disabled_at IS NOT NULL) AS disabled
            FROM repositories
            JOIN former_installations ON former_installations.id=repositories.installation_id
           ORDER BY repositories.id
           LIMIT 101
        )
        SELECT owner_export.id,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'repositoryId', bounded_repositories.id,
              'githubRepositoryId', bounded_repositories.github_repo_id,
              'owner', bounded_repositories.owner,
              'name', bounded_repositories.name,
              'private', bounded_repositories.private,
              'disabled', bounded_repositories.disabled
            ) ORDER BY bounded_repositories.id)
            FROM bounded_repositories
          ), '[]'::jsonb) AS repositories
          FROM owner_export LIMIT 1`,
        [input.exportId, input.verifiedGitHubUserId],
      );
      const row = (query as { rows?: Array<Record<string, unknown>> }).rows?.[0];
      if (!row) return null;
      if (
        row.id !== input.exportId ||
        !Array.isArray(row.repositories) ||
        row.repositories.length > maxRepositories ||
        !row.repositories.every(validRepository)
      )
        throw new HistoricalUserInventoryUnavailableError();
      const repositories = row.repositories as HistoricalRepository[];
      if (new Set(repositories.map((item) => item.repositoryId)).size !== repositories.length)
        throw new HistoricalUserInventoryUnavailableError();

      const bytes = Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          kind: "boardreadyops.historical-user-repository-preflight",
          coverage: "retained-suspended-user-installation-repositories-only",
          completeCustomerExport: false,
          exportId: input.exportId,
          exclusions: ["runs", "findings", "artifacts", "reviews", "comments", "audit", "platform-storage"],
          repositories,
        }),
        "utf8",
      );
      if (!bytes.length || bytes.length > maxBytes) throw new HistoricalUserInventoryUnavailableError();
      return {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.length,
        repositoryCount: repositories.length,
      };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}

const maxRuns = 100;
const maxFindings = 100;
const excludedClassNames = [
  "runSnapshots",
  "apiTokens",
  "runnerRegistrations",
  "installationComponentCredentials",
  "installationComponentObservations",
] as const;
type HistoricalExcludedClass = (typeof excludedClassNames)[number];
type HistoricalExcludedClassCounts = Record<HistoricalExcludedClass, number>;

// Counts only. Raw identities, access tokens, request identifiers and arbitrary
// audit metadata never enter the historical snapshot or downstream ZIP.
const auditRedactionClassNames = [
  "installationActorIdentities",
  "installationSubjectIdentifiers",
  "installationRequestIdentifiers",
  "installationPrivateMetadata",
  "repositoryActorIdentities",
  "repositorySubjectIdentifiers",
  "repositoryRequestIdentifiers",
  "repositoryPrivateMetadata",
] as const;
type HistoricalAuditRedactionClass = (typeof auditRedactionClassNames)[number];
type HistoricalAuditRedactionCounts = Record<HistoricalAuditRedactionClass, number>;

// audit_events.actor_type is only constrained by a generic regex in the DB;
// never copy unexpected values that might contain a human login.
const allowedHistoricalActorClasses = new Set(["system", "github_webhook", "internal", "guest", "runner"]);
function safeHistoricalActorClass(actorType: string): string {
  return allowedHistoricalActorClasses.has(actorType) ? actorType : "redacted";
}

function validAuditRedactionCounts(
  value: unknown,
  installationCount: number,
  repositoryCount: number,
): value is HistoricalAuditRedactionCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const counts = value as Record<string, unknown>;
  return (
    Object.keys(counts)
      .sort((a, b) => a.localeCompare(b))
      .join("|") === [...auditRedactionClassNames].sort((a, b) => a.localeCompare(b)).join("|") &&
    auditRedactionClassNames.every(
      (key) =>
        Number.isSafeInteger(counts[key]) &&
        (counts[key] as number) >= 0 &&
        (counts[key] as number) <= (key.startsWith("installation") ? installationCount : repositoryCount),
    )
  );
}

function validExcludedClassCounts(value: unknown): value is HistoricalExcludedClassCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .join("|") === [...excludedClassNames].sort((a, b) => a.localeCompare(b)).join("|") &&
    excludedClassNames.every(
      (key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0 && (record[key] as number) <= 100,
    )
  );
}

type HistoricalRunRow = {
  id: string;
  repository_id: string;
  commit_sha: string;
  ref: string;
  status: string;
  decision: string | null;
};
type HistoricalFindingRow = {
  id: string;
  run_id: string;
  rule_id: string;
  severity: string;
  message: string;
  path: string | null;
  kind: string | null;
};

function validText(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/**
 * INTERNAL bounded USER historical run/finding *preflight*, NOT full
 * historical export, ZIP bytes, or public HTTP content.
 *
 * Reuse the exact immutable numeric-owner CTE used for repository inventory.
 * Run and finding rows are drawn from the same *consistent* snapshot, but
 * never leak unrelated installations even when logins match. Return a digest
 * receipt only if ALL related records fit the declared limits.
 */
export async function prepareVerifiedHistoricalUserRunFindingSnapshot(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<{ bytes: Buffer; sha256: string; byteLength: number; runCount: number; findingCount: number } | null> {
  if (
    !db?.withTransaction ||
    !isUuid(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;

  return db.withTransaction(
    async (tx) => {
      const result = await tx.query(
        `WITH ${historicalOwnerCtes},
       permitted_repositories AS MATERIALIZED (
         SELECT repositories.id
           FROM repositories
           JOIN former_installations ON former_installations.id=repositories.installation_id
       ), run_rows AS (
         SELECT runs.id, runs.repository_id, runs.commit_sha, runs.ref,
                runs.status, runs.decision
           FROM release_runs AS runs
           JOIN permitted_repositories ON permitted_repositories.id=runs.repository_id
          ORDER BY runs.id LIMIT 101
       ), finding_rows AS (
         SELECT finding.id, finding.run_id, finding.rule_id,
                finding.severity, finding.message, finding.path, finding.kind
           FROM findings AS finding
           JOIN release_runs AS run ON run.id=finding.run_id
           JOIN permitted_repositories ON permitted_repositories.id=run.repository_id
          ORDER BY finding.id LIMIT 101
       ), bounded_repositories AS (
         SELECT id FROM permitted_repositories ORDER BY id LIMIT 101
       )
       SELECT owner_export.id,
              (SELECT COUNT(*) FROM bounded_repositories)::integer AS repository_count,
              COALESCE((SELECT jsonb_agg(to_jsonb(run_rows) ORDER BY run_rows.id)
                        FROM run_rows), '[]'::jsonb) AS runs,
              COALESCE((SELECT jsonb_agg(to_jsonb(finding_rows) ORDER BY finding_rows.id)
                        FROM finding_rows), '[]'::jsonb) AS findings
         FROM owner_export LIMIT 1`,
        [input.exportId, input.verifiedGitHubUserId],
      );
      const record = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];
      if (!record) return null;
      if (
        record.id !== input.exportId ||
        !Number.isInteger(record.repository_count) ||
        (record.repository_count as number) > maxRepositories ||
        !Array.isArray(record.runs) ||
        !Array.isArray(record.findings) ||
        record.runs.length > maxRuns ||
        record.findings.length > maxFindings
      )
        throw new HistoricalUserInventoryUnavailableError();

      const runRows = record.runs as HistoricalRunRow[];
      const findingRows = record.findings as HistoricalFindingRow[];
      if (
        runRows.some(
          (run) =>
            !isUuid(run?.id) ||
            !isUuid(run.repository_id) ||
            !validText(run.commit_sha, 128) ||
            !validText(run.ref) ||
            !validText(run.status) ||
            (run.decision !== null && !validText(run.decision)),
        ) ||
        findingRows.some(
          (finding) =>
            !isUuid(finding?.id) ||
            !isUuid(finding.run_id) ||
            !validText(finding.rule_id) ||
            !validText(finding.severity) ||
            typeof finding.message !== "string" ||
            (finding.path !== null && typeof finding.path !== "string") ||
            (finding.kind !== null && !validText(finding.kind)),
        )
      )
        throw new HistoricalUserInventoryUnavailableError();

      if (
        new Set(runRows.map((run) => run.id)).size !== runRows.length ||
        new Set(findingRows.map((finding) => finding.id)).size !== findingRows.length
      )
        throw new HistoricalUserInventoryUnavailableError();
      const permittedRunIds = new Set(runRows.map((run) => run.id));
      if (findingRows.some((finding) => !permittedRunIds.has(finding.run_id)))
        throw new HistoricalUserInventoryUnavailableError();

      const bytes = Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          kind: "boardreadyops.historical-user-run-finding-preflight",
          coverage: "retained-suspended-user-installation-runs-and-findings-only",
          completeCustomerExport: false,
          exportId: input.exportId,
          exclusions: ["artifact-bytes", "reviews", "comments", "audit", "platform-storage"],
          runs: runRows.map((run) => ({
            id: run.id,
            repositoryId: run.repository_id,
            commitSha: run.commit_sha,
            ref: run.ref,
            status: run.status,
            decision: run.decision,
          })),
          findings: findingRows.map((finding) => ({
            id: finding.id,
            runId: finding.run_id,
            ruleId: finding.rule_id,
            severity: finding.severity,
            message: finding.message,
            path: finding.path,
            kind: finding.kind,
          })),
        }),
        "utf8",
      );
      if (bytes.length === 0 || bytes.length > maxBytes) throw new HistoricalUserInventoryUnavailableError();
      return {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.length,
        runCount: runRows.length,
        findingCount: findingRows.length,
      };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}

type HistoricalArtifactRow = {
  id: string;
  run_id: string;
  kind: string;
  name: string;
  role: string;
  sha256: string;
  bytes: number;
  content_type: string;
  retention_expired: boolean;
};

type HistoricalReviewRow = {
  id: string;
  repository_id: string;
  head_run_id: string;
  title: string;
  status: string;
  decision: string;
  foreign_head_run: boolean;
};
type HistoricalRevisionRow = {
  id: string;
  review_id: string;
  sequence: number;
  base_run_id: string | null;
  head_run_id: string;
  head_commit_sha: string;
  evidence_digest: string;
  foreign_run: boolean;
};
type HistoricalCommentRow = {
  id: string;
  repository_id: string;
  review_id: string;
  parent_id: string | null;
  status: string;
  author_type: string;
  content: string;
  finding_fingerprint: string | null;
  evidence_anchor: string | null;
  foreign_repository: boolean;
  invalid_parent: boolean;
};
type HistoricalApprovalRow = {
  id: string;
  repository_id: string;
  review_id: string;
  revision_id: string;
  status: string;
  evidence_digest: string;
  reason: string | null;
  invalidation_reason: string | null;
  is_break_glass: boolean;
  foreign_repository: boolean;
};
type HistoricalChecklistRow = {
  id: string;
  repository_id: string;
  review_id: string;
  completed: boolean;
  title: string;
  foreign_repository: boolean;
};
type HistoricalFindingDecisionRow = {
  id: string;
  repository_id: string;
  review_id: string;
  finding_fingerprint: string;
  disposition: string;
  reason: string;
  evidence_digest: string;
  expires_at: string | null;
  foreign_repository: boolean;
};
type HistoricalFindingAssignmentRow = {
  id: string;
  repository_id: string;
  review_id: string;
  finding_fingerprint: string;
  foreign_repository: boolean;
};
type HistoricalInstallationAuditRow = {
  id: string;
  event_type: string;
  actor_type: string;
  subject_type: string;
};

type HistoricalAuditRow = {
  id: string;
  repository_id: string;
  release_run_id: string | null;
  event_type: string;
  actor_type: string;
  subject_type: string;
  foreign_review_subject: boolean;
};

type HistoricalCoreSnapshotRows = {
  repositories: HistoricalRepository[];
  runs: HistoricalRunRow[];
  findings: HistoricalFindingRow[];
  artifacts: HistoricalArtifactRow[];
  reviews: HistoricalReviewRow[];
  revisions: HistoricalRevisionRow[];
  audits: HistoricalAuditRow[];
  installationAudits: HistoricalInstallationAuditRow[];
  comments: HistoricalCommentRow[];
  approvals: HistoricalApprovalRow[];
  checklist: HistoricalChecklistRow[];
  findingDecisions: HistoricalFindingDecisionRow[];
  findingAssignments: HistoricalFindingAssignmentRow[];
  excludedSourceClassCounts: HistoricalExcludedClassCounts;
  redactedAuditFieldCounts: HistoricalAuditRedactionCounts;
};

function serializeHistoricalCoreSnapshot(input: { exportId: string }, rows: HistoricalCoreSnapshotRows) {
  const {
    repositories,
    runs,
    findings,
    artifacts,
    reviews,
    revisions,
    audits,
    installationAudits,
    comments,
    approvals,
    checklist,
    findingDecisions,
    findingAssignments,
    excludedSourceClassCounts,
    redactedAuditFieldCounts,
  } = rows;
  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.historical-user-consistent-core-preflight",
      coverage: "retained-suspended-user-installation-core-and-scoped-audit-descriptors-only",
      completeCustomerExport: false,
      exportId: input.exportId,
      exclusions: [
        "managed-artifact-bytes",
        "review-comment-author-identities",
        "review-approval-actor-identities",
        "review-checklist-completion-actor-identities",
        "finding-decision-owner-and-actor-identities",
        "finding-assignment-assignee-and-assigner-identities",
        "audit-metadata",
        "run-snapshot-private-visual-content",
        "api-token-hashes-prefixes-and-creator-identities",
        "runner-registration-identifiers",
        "installation-credential-envelopes",
        "installation-component-observation-data",
        "unverifiable-tenant-only-policy-and-billing-records",
        "platform-storage",
        "github-actions-source-logs",
        "unverified-collaboration-and-finding-free-text",
        "unverified-repository-review-and-artifact-identifying-metadata",
      ],
      // The original owner has not proven rights to disclose arbitrary
      // third-party comments, approvals, checklists or finding reasons.
      // Preserve the historical records in PostgreSQL, but NEVER embed
      // their free text in this private PARTIAL ZIP candidate.
      // Counts are the only contents for these five sensitive classes.
      // Tenant-login-only audit/billing records cannot be verified
      // against the immutable original numeric account and stay excluded.
      excludedSourceClassCounts,
      redactedAuditFieldCounts,
      repositories: repositories.map((repository) => ({
        ...repository,
        owner: "",
        name: "",
      })),
      runs: runs.map((run) => ({
        id: run.id,
        repositoryId: run.repository_id,
        commitSha: run.commit_sha,
        ref: "",
        status: run.status,
        decision: run.decision,
      })),
      findings: findings.map((finding) => ({
        id: finding.id,
        runId: finding.run_id,
        ruleId: finding.rule_id,
        severity: finding.severity,
        message: "",
        path: null,
        kind: finding.kind,
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        runId: artifact.run_id,
        kind: artifact.kind,
        name: "",
        role: artifact.role,
        sha256: artifact.sha256,
        byteLength: artifact.bytes,
        contentType: artifact.content_type,
        retentionExpired: artifact.retention_expired,
        // The artifact's presence, bytes and checksum were NOT verified.
        contentsVerified: false,
        downloadAvailable: false,
      })),
      reviews: reviews.map((review) => ({
        id: review.id,
        repositoryId: review.repository_id,
        headRunId: review.head_run_id,
        title: "",
        status: review.status,
        decision: review.decision,
      })),
      revisions: revisions.map((revision) => ({
        id: revision.id,
        reviewId: revision.review_id,
        sequence: revision.sequence,
        headRunId: revision.head_run_id,
        baseRunId: revision.base_run_id,
        headCommitSha: revision.head_commit_sha,
        evidenceDigest: revision.evidence_digest,
      })),
      reviewComments: comments.map((comment) => ({
        id: comment.id,
        repositoryId: comment.repository_id,
        reviewId: comment.review_id,
        parentId: comment.parent_id,
        status: comment.status,
        authorType: comment.author_type,
        content: "",
        findingFingerprint: comment.finding_fingerprint,
        evidenceAnchor: null,
        contentIncluded: false,
        authorIdIncluded: false,
      })),
      reviewApprovals: approvals.map((approval) => ({
        id: approval.id,
        repositoryId: approval.repository_id,
        reviewId: approval.review_id,
        revisionId: approval.revision_id,
        status: approval.status,
        evidenceDigest: approval.evidence_digest,
        reason: null,
        invalidationReason: null,
        isBreakGlass: approval.is_break_glass,
        actorIncluded: false,
      })),
      reviewChecklist: checklist.map((item) => ({
        id: item.id,
        repositoryId: item.repository_id,
        reviewId: item.review_id,
        completed: item.completed,
        title: "",
        titleIncluded: false,
        completedByIncluded: false,
      })),
      findingDecisions: findingDecisions.map((decision) => ({
        id: decision.id,
        repositoryId: decision.repository_id,
        reviewId: decision.review_id,
        findingFingerprint: decision.finding_fingerprint,
        disposition: decision.disposition,
        reason: "",
        evidenceDigest: decision.evidence_digest,
        expiresAt: decision.expires_at,
        ownerIncluded: false,
        actorIncluded: false,
      })),
      findingAssignments: findingAssignments.map((assignment) => ({
        id: assignment.id,
        repositoryId: assignment.repository_id,
        reviewId: assignment.review_id,
        findingFingerprint: assignment.finding_fingerprint,
        assigneeIncluded: false,
        assignedByIncluded: false,
      })),
      installationAuditEvents: installationAudits.map((audit) => ({
        id: audit.id,
        eventType: audit.event_type,
        actorType: safeHistoricalActorClass(audit.actor_type),
        subjectType: audit.subject_type,
        // Retain only the count of suppressed private fields, never the
        // human identifier, request token, metadata or installation ID.
        actorDetailsIncluded: false,
        subjectDetailsIncluded: false,
        requestIdIncluded: false,
        metadataIncluded: false,
      })),
      auditEvents: audits.map((audit) => ({
        id: audit.id,
        repositoryId: audit.repository_id,
        releaseRunId: audit.release_run_id,
        eventType: audit.event_type,
        actorType: safeHistoricalActorClass(audit.actor_type),
        subjectType: audit.subject_type,
        actorDetailsIncluded: false,
        subjectDetailsIncluded: false,
        requestIdIncluded: false,
        metadataIncluded: false,
        // Deliberately omit subjectId, actor identity and arbitrary metadata.
      })),
    }),
    "utf8",
  );
  if (bytes.length === 0 || bytes.length > maxBytes) throw new HistoricalUserInventoryUnavailableError();

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    repositoryCount: repositories.length,
    runCount: runs.length,
    findingCount: findings.length,
    artifactCount: artifacts.length,
    reviewCount: reviews.length,
    revisionCount: revisions.length,
    auditCount: audits.length,
    installationAuditCount: installationAudits.length,
    commentCount: comments.length,
    approvalCount: approvals.length,
    checklistCount: checklist.length,
    findingDecisionCount: findingDecisions.length,
    findingAssignmentCount: findingAssignments.length,
    excludedSourceClassCounts,
    redactedAuditFieldCounts,
  };
}

const historicalUserConsistentCoreSql = `WITH ${historicalOwnerCtes},
       permitted_repositories AS MATERIALIZED (
         SELECT repositories.id, repositories.installation_id,
                repositories.github_repo_id::text AS github_repo_id,
                repositories.owner, repositories.name, repositories.private,
                (repositories.disabled_at IS NOT NULL) AS disabled
           FROM repositories
           JOIN former_installations ON former_installations.id=repositories.installation_id
       ), repo_rows AS (
         SELECT * FROM permitted_repositories ORDER BY id LIMIT 101
       ), run_rows AS (
         SELECT runs.id, runs.repository_id, runs.commit_sha, runs.ref,
                runs.status, runs.decision
           FROM release_runs AS runs
           JOIN permitted_repositories ON permitted_repositories.id=runs.repository_id
          ORDER BY runs.id LIMIT 101
       ), finding_rows AS (
         SELECT finding.id, finding.run_id, finding.rule_id,
                finding.severity, finding.message, finding.path, finding.kind
           FROM findings AS finding
           JOIN release_runs AS run ON run.id=finding.run_id
           JOIN permitted_repositories ON permitted_repositories.id=run.repository_id
          ORDER BY finding.id LIMIT 101
       ), artifact_rows AS (
         SELECT artifacts.id, artifacts.run_id, artifacts.kind,
                artifacts.name, artifacts.role, artifacts.sha256,
                artifacts.bytes, artifacts.content_type,
                (artifacts.retention_until IS NOT NULL AND artifacts.retention_until <= NOW()) AS retention_expired
           FROM artifacts
           JOIN release_runs AS run ON run.id=artifacts.run_id
           JOIN permitted_repositories ON permitted_repositories.id=run.repository_id
          ORDER BY artifacts.id LIMIT 101
       ), review_rows AS (
         SELECT review.id, review.repository_id, review.head_run_id,
                review.title, review.status, review.decision,
                (head_run.repository_id IS DISTINCT FROM review.repository_id) AS foreign_head_run
           FROM reviews AS review
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
           LEFT JOIN release_runs AS head_run ON head_run.id=review.head_run_id
          ORDER BY review.id LIMIT 101
       ), revision_rows AS (
         SELECT revision.id, revision.review_id, revision.sequence,
                revision.base_run_id, revision.head_run_id,
                revision.head_commit_sha, revision.evidence_digest,
                (head_run.repository_id IS DISTINCT FROM review.repository_id OR
                 (revision.base_run_id IS NOT NULL AND base_run.repository_id IS DISTINCT FROM review.repository_id)
                ) AS foreign_run
           FROM review_revisions AS revision
           JOIN reviews AS review ON review.id=revision.review_id
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
           LEFT JOIN release_runs AS head_run ON head_run.id=revision.head_run_id
           LEFT JOIN release_runs AS base_run ON base_run.id=revision.base_run_id
          ORDER BY revision.id LIMIT 101
       ), comment_rows AS (
         SELECT comment.id, comment.repository_id, comment.review_id, comment.parent_id,
                comment.status, comment.author_type, comment.content,
                comment.finding_fingerprint, comment.evidence_anchor,
                (comment.repository_id IS DISTINCT FROM review.repository_id) AS foreign_repository,
                (comment.parent_id IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM review_comments AS parent
                   WHERE parent.id=comment.parent_id AND parent.id<>comment.id
                     AND parent.review_id=comment.review_id AND parent.repository_id=review.repository_id
                )) AS invalid_parent
           FROM review_comments AS comment
           JOIN reviews AS review ON review.id=comment.review_id
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
          ORDER BY comment.id LIMIT 101
       ), approval_rows AS (
         SELECT approval.id, approval.repository_id, approval.review_id,
                approval.revision_id, approval.status, approval.evidence_digest,
                approval.reason, approval.invalidation_reason, approval.is_break_glass,
                (approval.repository_id IS DISTINCT FROM review.repository_id) AS foreign_repository
           FROM review_approvals AS approval
           JOIN reviews AS review ON review.id=approval.review_id
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
          ORDER BY approval.id LIMIT 101
       ), checklist_rows AS (
         SELECT item.id, item.repository_id, item.review_id, item.completed, item.title,
                (item.repository_id IS DISTINCT FROM review.repository_id) AS foreign_repository
           FROM review_checklist_items AS item
           JOIN reviews AS review ON review.id=item.review_id
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
          ORDER BY item.id LIMIT 101
       ), finding_decision_rows AS (
         -- Decision and assignment IDs may use fdec_/fasn_ prefixes;
         -- always bind their opaque review foreign key to an owned review.
         SELECT d.id, d.repository_id, d.review_id, d.finding_fingerprint,
                d.disposition, d.reason, d.evidence_digest, d.expires_at,
                (d.repository_id IS DISTINCT FROM review.repository_id) AS foreign_repository
           FROM finding_decisions AS d
           JOIN reviews AS review ON review.id=d.review_id
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
          ORDER BY d.id LIMIT 101
       ), finding_assignment_rows AS (
         SELECT a.id, a.repository_id, a.review_id, a.finding_fingerprint,
                (a.repository_id IS DISTINCT FROM review.repository_id) AS foreign_repository
           FROM finding_assignments AS a
           JOIN reviews AS review ON review.id=a.review_id
           JOIN permitted_repositories ON permitted_repositories.id=review.repository_id
          ORDER BY a.id LIMIT 101
       ), excluded_source_count_rows AS (
         -- Only immutable numeric-user-account-scoped foreign keys. Count at
         -- most 101 per class; NEVER select SVG, tokens, credentials or PII.
         SELECT
           (SELECT count(*)::integer FROM (
             SELECT 1 FROM run_snapshots AS ss
             JOIN release_runs AS r ON r.id=ss.run_id
             JOIN permitted_repositories AS pr ON pr.id=r.repository_id LIMIT 101
           ) AS bounded) AS "runSnapshots",
           (SELECT count(*)::integer FROM (
             SELECT 1 FROM api_tokens AS tok
             JOIN permitted_repositories AS pr ON pr.id=tok.repository_id LIMIT 101
           ) AS bounded) AS "apiTokens",
           (SELECT count(*)::integer FROM (
             SELECT 1 FROM runner_registrations AS rr
             JOIN former_installations AS fi ON fi.id=rr.installation_id LIMIT 101
           ) AS bounded) AS "runnerRegistrations",
           (SELECT count(*)::integer FROM (
             SELECT 1 FROM installation_component_credentials AS cred
             JOIN former_installations AS fi ON fi.id=cred.installation_id LIMIT 101
           ) AS bounded) AS "installationComponentCredentials",
           (SELECT count(*)::integer FROM (
             SELECT 1 FROM installation_component_observations AS obs
             JOIN former_installations AS fi ON fi.id=obs.installation_id LIMIT 101
           ) AS bounded) AS "installationComponentObservations"
       ), installation_audit_rows AS (
         -- Audit events without repository dimension remain attributable to
         -- only the same immutable original USER account's suspended App.
         -- These booleans measure redaction only; never select raw identities.
         SELECT audit.id, audit.event_type, audit.actor_type, audit.subject_type,
                (audit.actor_id IS NOT NULL OR audit.actor_login IS NOT NULL) AS actor_identity_present,
                (audit.subject_id IS NOT NULL) AS subject_identifier_present,
                (audit.request_id IS NOT NULL) AS request_identifier_present,
                (audit.metadata <> '{}'::jsonb) AS private_metadata_present
           FROM audit_events AS audit
           JOIN former_installations ON former_installations.id=audit.installation_id
          WHERE audit.repository_id IS NULL
            AND audit.release_run_id IS NULL
            AND audit.artifact_id IS NULL
          ORDER BY audit.id LIMIT 101
       ), audit_rows AS (
         SELECT audit.id, audit.repository_id, audit.release_run_id,
                audit.event_type, audit.actor_type, audit.subject_type,
                (audit.actor_id IS NOT NULL OR audit.actor_login IS NOT NULL) AS actor_identity_present,
                (audit.subject_id IS NOT NULL) AS subject_identifier_present,
                (audit.request_id IS NOT NULL) AS request_identifier_present,
                (audit.metadata <> '{}'::jsonb) AS private_metadata_present,
                (audit.subject_type='review' AND audit.subject_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM reviews AS subject_review
                   WHERE subject_review.id=audit.subject_id
                     AND subject_review.repository_id<>audit.repository_id
                )) AS foreign_review_subject
           FROM audit_events AS audit
           JOIN permitted_repositories
             ON permitted_repositories.id=audit.repository_id
            AND permitted_repositories.installation_id=audit.installation_id
          ORDER BY audit.id LIMIT 101
       )
       SELECT owner_export.id,
              jsonb_build_object(
                'installationActorIdentities', (SELECT count(*)::integer FROM installation_audit_rows WHERE actor_identity_present),
                'installationSubjectIdentifiers', (SELECT count(*)::integer FROM installation_audit_rows WHERE subject_identifier_present),
                'installationRequestIdentifiers', (SELECT count(*)::integer FROM installation_audit_rows WHERE request_identifier_present),
                'installationPrivateMetadata', (SELECT count(*)::integer FROM installation_audit_rows WHERE private_metadata_present),
                'repositoryActorIdentities', (SELECT count(*)::integer FROM audit_rows WHERE actor_identity_present),
                'repositorySubjectIdentifiers', (SELECT count(*)::integer FROM audit_rows WHERE subject_identifier_present),
                'repositoryRequestIdentifiers', (SELECT count(*)::integer FROM audit_rows WHERE request_identifier_present),
                'repositoryPrivateMetadata', (SELECT count(*)::integer FROM audit_rows WHERE private_metadata_present)
              ) AS redacted_audit_field_counts,
              (SELECT to_jsonb(excluded_source_count_rows)
                 FROM excluded_source_count_rows) AS excluded_source_class_counts,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'repositoryId', repo_rows.id,
                'githubRepositoryId', repo_rows.github_repo_id,
                'owner', repo_rows.owner,
                'name', repo_rows.name,
                'private', repo_rows.private,
                'disabled', repo_rows.disabled
              ) ORDER BY repo_rows.id) FROM repo_rows), '[]'::jsonb) AS repositories,
              COALESCE((SELECT jsonb_agg(to_jsonb(run_rows) ORDER BY run_rows.id)
                        FROM run_rows), '[]'::jsonb) AS runs,
              COALESCE((SELECT jsonb_agg(to_jsonb(finding_rows) ORDER BY finding_rows.id)
                        FROM finding_rows), '[]'::jsonb) AS findings,
              COALESCE((SELECT jsonb_agg(to_jsonb(artifact_rows) ORDER BY artifact_rows.id)
                        FROM artifact_rows), '[]'::jsonb) AS artifacts,
              COALESCE((SELECT jsonb_agg(to_jsonb(review_rows) ORDER BY review_rows.id)
                        FROM review_rows), '[]'::jsonb) AS reviews,
              COALESCE((SELECT jsonb_agg(to_jsonb(revision_rows) ORDER BY revision_rows.id)
                        FROM revision_rows), '[]'::jsonb) AS revisions,
              COALESCE((SELECT jsonb_agg(to_jsonb(comment_rows) ORDER BY comment_rows.id)
                        FROM comment_rows), '[]'::jsonb) AS comments,
              COALESCE((SELECT jsonb_agg(to_jsonb(approval_rows) ORDER BY approval_rows.id)
                        FROM approval_rows), '[]'::jsonb) AS approvals,
              COALESCE((SELECT jsonb_agg(to_jsonb(checklist_rows) ORDER BY checklist_rows.id)
                        FROM checklist_rows), '[]'::jsonb) AS checklist,
              COALESCE((SELECT jsonb_agg(to_jsonb(finding_decision_rows) ORDER BY finding_decision_rows.id)
                        FROM finding_decision_rows), '[]'::jsonb) AS finding_decisions,
              COALESCE((SELECT jsonb_agg(to_jsonb(finding_assignment_rows) ORDER BY finding_assignment_rows.id)
                        FROM finding_assignment_rows), '[]'::jsonb) AS finding_assignments,
              COALESCE((SELECT jsonb_agg(to_jsonb(installation_audit_rows) ORDER BY installation_audit_rows.id)
                        FROM installation_audit_rows), '[]'::jsonb) AS installation_audit_events,
              COALESCE((SELECT jsonb_agg(to_jsonb(audit_rows) ORDER BY audit_rows.id)
                        FROM audit_rows), '[]'::jsonb) AS audit_events
         FROM owner_export LIMIT 1`;

/**
 * INTERNAL read-only historical USER metadata preflight. One immutable
 * owner check, one PostgreSQL statement and one repeatable-read snapshot
 * for retained repository/run/finding, artifact DESCRIPTORS, review,
 * revision, repository-scoped and original-installation-only audit
 * DESCRIPTORS. Never returns artifact contents or storage paths, private
 * audit payloads, original installation IDs or signed links.
 * Intentionally partial; grants no ZIP, erasure, claim or download right.
 */
export async function prepareVerifiedHistoricalUserConsistentCorePreflight(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<{
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  repositoryCount: number;
  runCount: number;
  findingCount: number;
  artifactCount: number;
  reviewCount: number;
  revisionCount: number;
  auditCount: number;
  installationAuditCount: number;
  commentCount: number;
  approvalCount: number;
  checklistCount: number;
  findingDecisionCount: number;
  findingAssignmentCount: number;
  excludedSourceClassCounts: HistoricalExcludedClassCounts;
  redactedAuditFieldCounts: HistoricalAuditRedactionCounts;
} | null> {
  if (
    !db?.withTransaction ||
    !isUuid(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;

  return db.withTransaction(
    async (tx) => {
      const result = await tx.query(historicalUserConsistentCoreSql, [input.exportId, input.verifiedGitHubUserId]);
      const record = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];
      if (!record) return null;
      if (
        record.id !== input.exportId ||
        !Array.isArray(record.repositories) ||
        !Array.isArray(record.runs) ||
        !Array.isArray(record.findings) ||
        !Array.isArray(record.artifacts) ||
        !Array.isArray(record.reviews) ||
        !Array.isArray(record.revisions) ||
        !Array.isArray(record.audit_events) ||
        !Array.isArray(record.installation_audit_events) ||
        !Array.isArray(record.comments) ||
        !Array.isArray(record.approvals) ||
        !Array.isArray(record.checklist) ||
        !Array.isArray(record.finding_decisions) ||
        !Array.isArray(record.finding_assignments) ||
        !validExcludedClassCounts(record.excluded_source_class_counts) ||
        !validAuditRedactionCounts(
          record.redacted_audit_field_counts,
          record.installation_audit_events.length,
          record.audit_events.length,
        ) ||
        record.repositories.length > maxRepositories ||
        record.runs.length > maxRuns ||
        record.findings.length > maxFindings ||
        record.artifacts.length > 100 ||
        record.reviews.length > 100 ||
        record.revisions.length > 100 ||
        record.audit_events.length > 100 ||
        record.installation_audit_events.length > 100 ||
        record.comments.length > 100 ||
        record.approvals.length > 100 ||
        record.checklist.length > 100 ||
        record.finding_decisions.length > 100 ||
        record.finding_assignments.length > 100 ||
        !record.repositories.every(validRepository)
      )
        throw new HistoricalUserInventoryUnavailableError();

      const repositories = record.repositories as HistoricalRepository[];
      const runs = record.runs as HistoricalRunRow[];
      const findings = record.findings as HistoricalFindingRow[];
      const artifacts = record.artifacts as HistoricalArtifactRow[];
      const reviews = record.reviews as HistoricalReviewRow[];
      const revisions = record.revisions as HistoricalRevisionRow[];
      const audits = record.audit_events as HistoricalAuditRow[];
      const installationAudits = record.installation_audit_events as HistoricalInstallationAuditRow[];
      const comments = record.comments as HistoricalCommentRow[];
      const approvals = record.approvals as HistoricalApprovalRow[];
      const checklist = record.checklist as HistoricalChecklistRow[];
      const findingDecisions = record.finding_decisions as HistoricalFindingDecisionRow[];
      const findingAssignments = record.finding_assignments as HistoricalFindingAssignmentRow[];
      const excludedSourceClassCounts = record.excluded_source_class_counts as HistoricalExcludedClassCounts;
      const redactedAuditFieldCounts = record.redacted_audit_field_counts as HistoricalAuditRedactionCounts;
      if (
        new Set(repositories.map((repo) => repo.repositoryId)).size !== repositories.length ||
        new Set(runs.map((run) => run.id)).size !== runs.length ||
        new Set(findings.map((finding) => finding.id)).size !== findings.length ||
        new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length ||
        new Set(reviews.map((review) => review.id)).size !== reviews.length ||
        new Set(revisions.map((revision) => revision.id)).size !== revisions.length ||
        new Set(audits.map((audit) => audit.id)).size !== audits.length ||
        new Set(installationAudits.map((audit) => audit.id)).size !== installationAudits.length ||
        installationAudits.some(
          (audit) =>
            !isUuid(audit?.id) ||
            !validText(audit.event_type, 160) ||
            !validText(audit.actor_type, 64) ||
            !validText(audit.subject_type, 64),
        ) ||
        new Set(comments.map((comment) => comment.id)).size !== comments.length ||
        new Set(approvals.map((approval) => approval.id)).size !== approvals.length ||
        new Set(checklist.map((item) => item.id)).size !== checklist.length ||
        new Set(findingDecisions.map((d) => d.id)).size !== findingDecisions.length ||
        new Set(findingAssignments.map((a) => a.id)).size !== findingAssignments.length ||
        findingDecisions.some(
          (decision) =>
            !validText(decision?.id) ||
            !isUuid(decision.repository_id) ||
            !isUuid(decision.review_id) ||
            !validText(decision.finding_fingerprint, 2048) ||
            Buffer.byteLength(decision.finding_fingerprint, "utf8") > 2048 ||
            !["accepted_risk", "false_positive", "mitigated", "fix_required", "deferred"].includes(
              decision.disposition,
            ) ||
            typeof decision.reason !== "string" ||
            Buffer.byteLength(decision.reason, "utf8") > 4096 ||
            !/^[0-9a-f]{64}$/u.test(decision.evidence_digest) ||
            (decision.expires_at !== null &&
              (typeof decision.expires_at !== "string" || !Number.isFinite(Date.parse(decision.expires_at)))) ||
            decision.foreign_repository !== false,
        ) ||
        findingAssignments.some(
          (assignment) =>
            !validText(assignment?.id) ||
            !isUuid(assignment.repository_id) ||
            !isUuid(assignment.review_id) ||
            !validText(assignment.finding_fingerprint, 2048) ||
            Buffer.byteLength(assignment.finding_fingerprint, "utf8") > 2048 ||
            assignment.foreign_repository !== false,
        ) ||
        comments.some(
          (comment) =>
            !validText(comment?.id) ||
            !isUuid(comment.repository_id) ||
            !isUuid(comment.review_id) ||
            (comment.parent_id !== null && !validText(comment.parent_id)) ||
            !["open", "resolved", "stale"].includes(comment.status) ||
            !["internal", "guest"].includes(comment.author_type) ||
            typeof comment.content !== "string" ||
            Buffer.byteLength(comment.content, "utf8") > 8192 ||
            (comment.finding_fingerprint !== null &&
              (!validText(comment.finding_fingerprint, 256) ||
                Buffer.byteLength(comment.finding_fingerprint, "utf8") > 512)) ||
            (comment.evidence_anchor !== null &&
              (!validText(comment.evidence_anchor, 2048) ||
                Buffer.byteLength(comment.evidence_anchor, "utf8") > 4096)) ||
            comment.foreign_repository !== false ||
            comment.invalid_parent !== false,
        ) ||
        approvals.some(
          (approval) =>
            !validText(approval?.id) ||
            !isUuid(approval.repository_id) ||
            !isUuid(approval.review_id) ||
            !isUuid(approval.revision_id) ||
            !/^[0-9a-f]{64}$/u.test(approval.evidence_digest) ||
            !["approved", "changes_requested", "invalidated", "dismissed"].includes(approval.status) ||
            (approval.reason !== null &&
              (typeof approval.reason !== "string" || Buffer.byteLength(approval.reason, "utf8") > 8192)) ||
            (approval.invalidation_reason !== null &&
              (typeof approval.invalidation_reason !== "string" ||
                Buffer.byteLength(approval.invalidation_reason, "utf8") > 8192)) ||
            typeof approval.is_break_glass !== "boolean" ||
            approval.foreign_repository !== false,
        ) ||
        checklist.some(
          (item) =>
            !validText(item?.id) ||
            !isUuid(item.repository_id) ||
            !isUuid(item.review_id) ||
            typeof item.completed !== "boolean" ||
            typeof item.title !== "string" ||
            Buffer.byteLength(item.title, "utf8") > 8192 ||
            item.foreign_repository !== false,
        ) ||
        reviews.some(
          (review) =>
            !isUuid(review?.id) ||
            !isUuid(review.repository_id) ||
            !isUuid(review.head_run_id) ||
            typeof review.title !== "string" ||
            Buffer.byteLength(review.title, "utf8") > 8192 ||
            !validText(review.status) ||
            !validText(review.decision) ||
            review.foreign_head_run !== false,
        ) ||
        revisions.some(
          (revision) =>
            !isUuid(revision?.id) ||
            !isUuid(revision.review_id) ||
            !Number.isSafeInteger(revision.sequence) ||
            revision.sequence < 1 ||
            !isUuid(revision.head_run_id) ||
            (revision.base_run_id !== null && !isUuid(revision.base_run_id)) ||
            typeof revision.head_commit_sha !== "string" ||
            !/^[0-9a-f]{40,64}$/u.test(revision.head_commit_sha) ||
            typeof revision.evidence_digest !== "string" ||
            !/^[0-9a-f]{64}$/u.test(revision.evidence_digest) ||
            revision.foreign_run !== false,
        ) ||
        audits.some(
          (audit) =>
            !isUuid(audit?.id) ||
            !isUuid(audit.repository_id) ||
            (audit.release_run_id !== null && !isUuid(audit.release_run_id)) ||
            !validText(audit.event_type, 160) ||
            !validText(audit.actor_type, 64) ||
            !validText(audit.subject_type, 64) ||
            audit.foreign_review_subject !== false,
        ) ||
        artifacts.some(
          (artifact) =>
            !isUuid(artifact?.id) ||
            !isUuid(artifact.run_id) ||
            !validText(artifact.kind) ||
            !validText(artifact.name, 1024) ||
            !validText(artifact.role) ||
            !validText(artifact.content_type) ||
            typeof artifact.sha256 !== "string" ||
            !/^[0-9a-f]{64}$/u.test(artifact.sha256) ||
            typeof artifact.bytes !== "number" ||
            !Number.isSafeInteger(artifact.bytes) ||
            artifact.bytes < 0 ||
            typeof artifact.retention_expired !== "boolean",
        ) ||
        runs.some(
          (run) =>
            !isUuid(run?.id) ||
            !isUuid(run.repository_id) ||
            !validText(run.commit_sha, 128) ||
            !validText(run.ref) ||
            !validText(run.status) ||
            (run.decision !== null && !validText(run.decision)),
        ) ||
        findings.some(
          (finding) =>
            !isUuid(finding?.id) ||
            !isUuid(finding.run_id) ||
            !validText(finding.rule_id) ||
            !validText(finding.severity) ||
            typeof finding.message !== "string" ||
            (finding.path !== null && typeof finding.path !== "string") ||
            (finding.kind !== null && !validText(finding.kind)),
        )
      )
        throw new HistoricalUserInventoryUnavailableError();

      const permittedRepositories = new Set(repositories.map((repo) => repo.repositoryId));
      const permittedRuns = new Set(runs.map((run) => run.id));
      const permittedReviews = new Set(reviews.map((review) => review.id));
      const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
      const commentParents = new Map(comments.map((comment) => [comment.id, comment]));
      const runRepositories = new Map(runs.map((run) => [run.id, run.repository_id]));
      const reviewRepositories = new Map(reviews.map((review) => [review.id, review.repository_id]));
      if (
        runs.some((run) => !permittedRepositories.has(run.repository_id)) ||
        findings.some((finding) => !permittedRuns.has(finding.run_id)) ||
        artifacts.some((artifact) => !permittedRuns.has(artifact.run_id)) ||
        reviews.some(
          (review) =>
            !permittedRepositories.has(review.repository_id) ||
            runRepositories.get(review.head_run_id) !== review.repository_id,
        ) ||
        revisions.some(
          (revision) =>
            !permittedReviews.has(revision.review_id) ||
            runRepositories.get(revision.head_run_id) !== reviewRepositories.get(revision.review_id) ||
            (revision.base_run_id !== null &&
              runRepositories.get(revision.base_run_id) !== reviewRepositories.get(revision.review_id)),
        ) ||
        comments.some((comment) => {
          if (!permittedReviews.has(comment.review_id)) return true;
          const seen = new Set([comment.id]);
          let cursor = comment;
          while (cursor.parent_id !== null) {
            const parent = commentParents.get(cursor.parent_id);
            if (
              !parent ||
              parent.review_id !== comment.review_id ||
              parent.repository_id !== comment.repository_id ||
              seen.has(parent.id)
            )
              return true;
            seen.add(parent.id);
            cursor = parent;
          }
          return false;
        }) ||
        approvals.some(
          (approval) =>
            !permittedReviews.has(approval.review_id) ||
            revisionsById.get(approval.revision_id)?.review_id !== approval.review_id,
        ) ||
        checklist.some((item) => !permittedReviews.has(item.review_id)) ||
        findingDecisions.some(
          (decision) =>
            !permittedReviews.has(decision.review_id) ||
            reviewRepositories.get(decision.review_id) !== decision.repository_id,
        ) ||
        findingAssignments.some(
          (assignment) =>
            !permittedReviews.has(assignment.review_id) ||
            reviewRepositories.get(assignment.review_id) !== assignment.repository_id,
        ) ||
        audits.some(
          (audit) =>
            !permittedRepositories.has(audit.repository_id) ||
            (audit.release_run_id !== null && runRepositories.get(audit.release_run_id) !== audit.repository_id),
        )
      )
        throw new HistoricalUserInventoryUnavailableError();

      return serializeHistoricalCoreSnapshot(input, {
        repositories,
        runs,
        findings,
        artifacts,
        reviews,
        revisions,
        audits,
        installationAudits,
        comments,
        approvals,
        checklist,
        findingDecisions,
        findingAssignments,
        excludedSourceClassCounts,
        redactedAuditFieldCounts,
      });
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}

/**
 * SOURCE-ONLY original numeric GitHub USER private visual digest preflight.
 * Does not return SVG/PNG/WebP bytes, metadata anchors, filenames or URLs.
 * A source visual must have an independently verified digest before anyone
 * may consider adding it to a complete customer archive in the future.
 */
export async function prepareVerifiedHistoricalUserPrivateVisualEvidence(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<{
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  visualCount: number;
} | null> {
  if (
    !db?.withTransaction ||
    !isUuid(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;

  return db.withTransaction(
    async (tx) => {
      const result = await tx.query(
        `WITH ${historicalOwnerCtes},
      permitted_repositories AS MATERIALIZED (
        SELECT repo.id FROM repositories AS repo
        JOIN former_installations AS owner ON owner.id=repo.installation_id
      ),
      scoped_visual_rows AS (
        SELECT s.id, s.run_id, run.repository_id, s.snapshot_id,
               s.kind, s.format, s.sha256,
               octet_length(s.content)::integer AS content_bytes,
               CASE WHEN octet_length(s.content)<=262144
                    THEN s.content ELSE NULL END AS content
          FROM run_snapshots AS s
          JOIN release_runs AS run ON run.id=s.run_id
          JOIN permitted_repositories AS allowed ON allowed.id=run.repository_id
         ORDER BY s.id LIMIT 101
      )
      SELECT owner_export.id AS export_id,
             visual.id,visual.run_id,visual.repository_id,
             visual.snapshot_id,visual.kind,visual.format,
             visual.sha256,visual.content_bytes,visual.content
        FROM owner_export
        LEFT JOIN scoped_visual_rows AS visual ON TRUE
       WHERE EXISTS (
         SELECT 1 FROM data_exports AS active
          WHERE active.id=owner_export.id
            AND (active.expires_at IS NULL OR active.expires_at>clock_timestamp())
       )
       ORDER BY visual.id`,
        [input.exportId, input.verifiedGitHubUserId],
      );
      const rows = (result as { rows?: Array<Record<string, unknown>> }).rows;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      if (rows.length > 100) throw new HistoricalUserInventoryUnavailableError();
      const descriptors: Array<{
        id: string;
        runId: string;
        repositoryId: string;
        kind: string;
        format: "svg";
        sha256: string;
        byteLength: number;
      }> = [];
      const seen = new Set<string>();
      let totalVisualBytes = 0;
      for (const row of rows) {
        if (row.export_id !== input.exportId) throw new HistoricalUserInventoryUnavailableError();
        if (row.id === null) continue;
        if (
          !isUuid(row.id) ||
          !isUuid(row.run_id) ||
          !isUuid(row.repository_id) ||
          seen.has(row.id) ||
          !validText(row.snapshot_id, 256) ||
          !["schematic", "pcb_layer", "3d_render"].includes(String(row.kind)) ||
          row.format !== "svg" ||
          !Number.isSafeInteger(row.content_bytes) ||
          (row.content_bytes as number) <= 0 ||
          (row.content_bytes as number) > 262144 ||
          typeof row.content !== "string" ||
          !/^[0-9a-f]{64}$/u.test(String(row.sha256))
        )
          throw new HistoricalUserInventoryUnavailableError();
        const content = Buffer.from(row.content, "utf8");
        if (content.length !== row.content_bytes || createHash("sha256").update(content).digest("hex") !== row.sha256)
          throw new HistoricalUserInventoryUnavailableError();
        totalVisualBytes += content.length;
        if (totalVisualBytes > 4 * 1024 * 1024) throw new HistoricalUserInventoryUnavailableError();
        seen.add(row.id);
        descriptors.push({
          id: row.id,
          runId: row.run_id,
          repositoryId: row.repository_id,
          // Sheet-derived snapshot IDs are private and not exposed.
          kind: String(row.kind),
          format: "svg",
          sha256: row.sha256,
          byteLength: content.length,
        });
      }
      const bytes = Buffer.from(
        JSON.stringify({
          kind: "boardreadyops.historical-user-private-visual-evidence-preflight",
          formatVersion: 1,
          exportId: input.exportId,
          completeCustomerExport: false,
          contentIncluded: false,
          exclusions: [
            "visual-svg-content",
            "visual-anchors-and-rendering-metadata",
            "non-svg-visual-formats-unverified",
            "actor-and-audit-identities",
          ],
          visuals: descriptors,
        }),
        "utf8",
      );
      if (!bytes.length || bytes.length > maxBytes) throw new HistoricalUserInventoryUnavailableError();
      return {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.length,
        visualCount: descriptors.length,
      };
    },
    { consistentRead: true, statementTimeoutMs: 5_000 },
  );
}

/**
 * SOURCE-ONLY: produce BOTH historical original numeric-USER metadata and
 * visual SHA-evidence from one PostgreSQL REPEATABLE READ READ ONLY snapshot.
 *
 * The two existing bounded preflights each support a transaction callback.
 * Pass an adapter restricted to the already-open outer transaction: opening a
 * nested real transaction would silently break snapshot consistency.
 * No visual SVG bytes or private sheet/anchor names leave the preflights.
 *
 * This does not lock concurrent writers, prove a serializable sequence over
 * filesystem reads, prevent ABA changes after commit, or grant delivery.
 */
export async function prepareVerifiedHistoricalUserCompositePreflight(
  db: Pick<PgQueryExecutor, "withTransaction">,
  authority: { exportId: string; verifiedGitHubUserId: number },
): Promise<{
  core: NonNullable<Awaited<ReturnType<typeof prepareVerifiedHistoricalUserConsistentCorePreflight>>>;
  visual: NonNullable<Awaited<ReturnType<typeof prepareVerifiedHistoricalUserPrivateVisualEvidence>>>;
  /** Scoped counter fingerprint, never installation identifiers or private content. */
  mutationEpochSha256: string;
} | null> {
  if (!db?.withTransaction) return null;
  return db.withTransaction(
    async (tx) => {
      // Both calls operate on this SAME read-only snapshot, not a new client.
      const bound: Pick<PgQueryExecutor, "withTransaction"> = {
        async withTransaction<T>(
          work: (transaction: SqlQueryExecutor) => Promise<T>,
          options?: { statementTimeoutMs?: number; consistentRead?: true },
        ): Promise<T> {
          if (options?.consistentRead !== true) {
            throw new HistoricalUserInventoryUnavailableError();
          }
          return work(tx);
        },
      };
      const core = await prepareVerifiedHistoricalUserConsistentCorePreflight(bound, authority);
      if (!core) return null;
      const visual = await prepareVerifiedHistoricalUserPrivateVisualEvidence(bound, authority);
      if (!visual) throw new HistoricalUserInventoryUnavailableError();
      // In THIS same repeatable-read snapshot, capture committed mutations
      // that may have changed and later restored byte-identical core/visuals.
      // Only owner-ID-verified, suspended USER installations may contribute.
      const revisionsResult = await tx.query(
        `WITH ${historicalOwnerCtes}
           SELECT fi.id,COALESCE(epoch.revision,0)::text AS revision
             FROM former_installations fi
             LEFT JOIN public.historical_user_snapshot_mutation_epochs epoch
               ON epoch.installation_id=fi.id
            ORDER BY fi.id LIMIT 101`,
        [authority.exportId, authority.verifiedGitHubUserId],
      );
      const revisions = (revisionsResult as { rows?: Array<{ id: unknown; revision: unknown }> }).rows;
      if (
        !revisions ||
        revisions.length === 0 ||
        revisions.length > 100 ||
        revisions.some(
          (row) =>
            !isUuid(row.id) || typeof row.revision !== "string" || !/^(?:0|[1-9][0-9]{0,18})$/u.test(row.revision),
        )
      )
        throw new HistoricalUserInventoryUnavailableError();
      const mutationEpochSha256 = createHash("sha256")
        .update("boardreadyops.historical-user-snapshot-mutation-v1\n")
        .update(JSON.stringify(revisions.map((r) => [r.id, r.revision])))
        .digest("hex");
      return { core, visual, mutationEpochSha256 };
    },
    { consistentRead: true, statementTimeoutMs: 10_000 },
  );
}
