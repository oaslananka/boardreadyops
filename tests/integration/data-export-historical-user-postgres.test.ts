import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  HistoricalUserInventoryUnavailableError,
  prepareVerifiedHistoricalUserCompositePreflight,
  prepareVerifiedHistoricalUserConsistentCorePreflight,
  prepareVerifiedHistoricalUserPrivateVisualEvidence,
  prepareVerifiedHistoricalUserRepositoryInventory,
  prepareVerifiedHistoricalUserRunFindingSnapshot,
} from "../../packages/db/src/data-export-historical-inventory.js";
import { assessHistoricalUserUnresolvedOwnerRows } from "../../packages/db/src/data-export-historical-unresolved-owner-rows.js";
import { DataLifecycleStore } from "../../packages/db/src/data-lifecycle-store.js";
import { createSqlGitHubAppMetadataStore } from "../../packages/db/src/lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const login = `historical-${randomUUID().slice(0, 8)}`;
const accountUserId = 917004321;
const externalInstallationId = 420000 + Math.floor(Math.random() * 100000);
const installation = {
  id: externalInstallationId,
  accountUserId,
  accountLogin: login,
  accountType: "User",
};
const legacyIds: string[] = [];
function executor() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}
function rows(result: unknown): Record<string, unknown>[] {
  return (result as { rows?: Record<string, unknown>[] })?.rows ?? [];
}
const store = () =>
  createSqlGitHubAppMetadataStore(executor(), {
    id: randomUUID,
    now: () => new Date("2026-11-05T09:00:00.000Z"),
  });

afterAll(async () => {
  if (!db) return;
  try {
    await executor().query("DELETE FROM data_exports WHERE tenant_id=$1", [login]);
    await executor().query("DELETE FROM erasure_requests WHERE tenant_id=$1", [login]);
    await executor().query("DELETE FROM installations WHERE github_installation_id=$1", [externalInstallationId]);
  } finally {
    await db.close();
  }
});

function makeHistoricalSnapshotFixture(exportId: string, sourceInstallationId: string) {
  const ownerRepo = randomUUID();
  const ownerRun = randomUUID();
  const ownerFinding = randomUUID();
  const lookalikeInstallation = randomUUID();
  const lookalikeRepo = randomUUID();
  const lookalikeRun = randomUUID();
  const lookalikeFinding = randomUUID();
  const ownerArtifact = randomUUID();
  const foreignArtifact = randomUUID();
  const ownerReview = randomUUID();
  const foreignReview = randomUUID();
  const ownerRevision = randomUUID();
  const foreignRevision = randomUUID();
  const ownerComment = randomUUID();
  const foreignComment = randomUUID();
  const ownerApproval = randomUUID();
  const foreignApproval = randomUUID();
  const ownerChecklist = randomUUID();
  const foreignChecklist = randomUUID();
  const ownerDecision = `fdec_${randomUUID()}`;
  const foreignDecision = `fdec_${randomUUID()}`;
  const ownerAssignment = `fasn_${randomUUID()}`;
  const foreignAssignment = `fasn_${randomUUID()}`;
  const ownerInstallationAudit = randomUUID();
  const foreignInstallationAudit = randomUUID();
  const ownerAudit = randomUUID();
  const foreignAudit = randomUUID();
  const crossAudit = randomUUID();
  const repoNumber = 8_000_000_000 + Math.floor(Math.random() * 100_000);
  return {
    exportId,
    sourceInstallationId,
    ownerRepo,
    ownerRun,
    ownerFinding,
    lookalikeInstallation,
    lookalikeRepo,
    lookalikeRun,
    lookalikeFinding,
    ownerArtifact,
    foreignArtifact,
    ownerReview,
    foreignReview,
    ownerRevision,
    foreignRevision,
    ownerComment,
    foreignComment,
    ownerApproval,
    foreignApproval,
    ownerChecklist,
    foreignChecklist,
    ownerDecision,
    foreignDecision,
    ownerAssignment,
    foreignAssignment,
    ownerInstallationAudit,
    foreignInstallationAudit,
    ownerAudit,
    foreignAudit,
    crossAudit,
    repoNumber,
  };
}

type HistoricalSnapshotFixture = ReturnType<typeof makeHistoricalSnapshotFixture>;
type HistoricalTestProbe = Parameters<typeof prepareVerifiedHistoricalUserConsistentCorePreflight>[0] & {
  query: ReturnType<typeof executor>["query"];
};

async function seedHistoricalSnapshotFixtures(
  probe: HistoricalTestProbe,
  fixture: HistoricalSnapshotFixture,
): Promise<void> {
  const {
    sourceInstallationId,
    ownerRepo,
    ownerRun,
    ownerFinding,
    lookalikeInstallation,
    lookalikeRepo,
    lookalikeRun,
    lookalikeFinding,
    ownerArtifact,
    foreignArtifact,
    ownerReview,
    foreignReview,
    ownerRevision,
    foreignRevision,
    ownerComment,
    foreignComment,
    ownerApproval,
    foreignApproval,
    ownerChecklist,
    foreignChecklist,
    ownerDecision,
    foreignDecision,
    ownerAssignment,
    foreignAssignment,
    ownerInstallationAudit,
    foreignInstallationAudit,
    ownerAudit,
    foreignAudit,
    repoNumber,
  } = fixture;
  await probe.query(
    `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch,disabled_at)
  VALUES($1,$2,$3,$4,'retained-user-evidence','main',NOW())`,
    [ownerRepo, sourceInstallationId, repoNumber, login],
  );
  await probe.query(
    `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
  VALUES($1,$2,$3,'User',$4,NOW())`,
    [lookalikeInstallation, externalInstallationId + 8_000_000, login, accountUserId + 99],
  );
  await probe.query(
    `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
  VALUES($1,$2,$3,$4,'lookalike-evidence','main')`,
    [lookalikeRepo, lookalikeInstallation, repoNumber + 1, login],
  );
  for (const [repo, run, finding, tag] of [
    [ownerRepo, ownerRun, ownerFinding, "owner"],
    [lookalikeRepo, lookalikeRun, lookalikeFinding, "foreign"],
  ]) {
    await probe.query(
      `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
    VALUES($1,$2,$3,'refs/heads/main','manual','completed')`,
      [run, repo, "a".repeat(40)],
    );
    await probe.query(
      `INSERT INTO findings(id,run_id,rule_id,severity,message,path,kind)
    VALUES($1,$2,$3,'warning',$4,'board.kicad_pcb','erc')`,
      [finding, run, `rule-${tag}`, `private-finding-${tag}`],
    );
    await probe.query(
      `INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,uploaded_at,retention_until)
    VALUES($1,$2,'manufacturing',$3,'package',$4,$5,512,'application/zip',
           '2026-11-01'::timestamptz,'2026-11-02'::timestamptz)`,
      [
        tag === "owner" ? ownerArtifact : foreignArtifact,
        run,
        `test-${tag}.zip`,
        `secret/internal/owner-${tag}`,
        tag === "owner" ? "d".repeat(64) : "e".repeat(64),
      ],
    );
    const reviewId = tag === "owner" ? ownerReview : foreignReview;
    await probe.query(
      `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
    VALUES($1,$2,$3,'completed','approved',$4)`,
      [reviewId, repo, `sensitive-review-${tag}`, run],
    );
    await probe.query(
      `INSERT INTO review_revisions(id,review_id,sequence,head_run_id,head_commit_sha,evidence_digest)
    VALUES($1,$2,1,$3,$4,$5)`,
      [tag === "owner" ? ownerRevision : foreignRevision, reviewId, run, "a".repeat(40), "b".repeat(64)],
    );
    await probe.query(
      `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
        VALUES($1,$2,$3,$4,$5)`,
      [tag === "owner" ? ownerComment : foreignComment, repo, reviewId, `reviewer-${tag}`, `private-comment-${tag}`],
    );
    await probe.query(
      `INSERT INTO review_approvals(id,repository_id,review_id,revision_id,evidence_digest,approver_id,status,reason)
        VALUES($1,$2,$3,$4,$5,$6,'approved',$7)`,
      [
        tag === "owner" ? ownerApproval : foreignApproval,
        repo,
        reviewId,
        tag === "owner" ? ownerRevision : foreignRevision,
        "b".repeat(64),
        `reviewer-${tag}`,
        `private-approval-reason-${tag}`,
      ],
    );
    await probe.query(
      `INSERT INTO review_checklist_items(id,repository_id,review_id,title,completed)
        VALUES($1,$2,$3,$4,TRUE)`,
      [tag === "owner" ? ownerChecklist : foreignChecklist, repo, reviewId, `private-title-${tag}`],
    );
    await probe.query(
      `INSERT INTO finding_decisions(id,repository_id,review_id,finding_fingerprint,disposition,reason,owner,evidence_digest,actor_id)
        VALUES($1,$2,$3,$4,'mitigated',$5,$6,$7,$8)`,
      [
        tag === "owner" ? ownerDecision : foreignDecision,
        repo,
        reviewId,
        `finding-fingerprint-${tag}`,
        `private-finding-decision-reason-${tag}`,
        `secret-finding-owner-${tag}`,
        "c".repeat(64),
        `secret-finding-actor-${tag}`,
      ],
    );
    await probe.query(
      `INSERT INTO finding_assignments(id,repository_id,review_id,finding_fingerprint,assignee,assigned_by)
        VALUES($1,$2,$3,$4,$5,$6)`,
      [
        tag === "owner" ? ownerAssignment : foreignAssignment,
        repo,
        reviewId,
        `finding-fingerprint-${tag}`,
        `private-finding-assignee-${tag}`,
        `private-assigned-by-${tag}`,
      ],
    );
    // Count sensitive records without copying secrets, design IP or
    // runner identities. Include same-login foreign owner adversary.
    const fixtureInstallation = tag === "owner" ? sourceInstallationId : lookalikeInstallation;
    await probe.query(
      `INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256)
        VALUES($1,$2,$3,$4,'pcb_layer','svg','F.Cu',100,80,$5,$6)`,
      [
        randomUUID(),
        run,
        `snapshot-${tag}`,
        `private-visual-${tag}`,
        `<svg>private-kicad-design-${tag}</svg>`,
        tag === "owner" ? "7".repeat(64) : "8".repeat(64),
      ],
    );
    await probe.query(
      `INSERT INTO api_tokens(id,repository_id,name,token_prefix,token_hash)
        VALUES($1,$2,$3,$4,$5)`,
      [
        randomUUID(),
        repo,
        `private-api-token-${tag}`,
        `secret-prefix-${tag}`,
        tag === "owner" ? "7".repeat(64) : "8".repeat(64),
      ],
    );
    await probe.query(
      `INSERT INTO runner_registrations(id,installation_id,name)
        VALUES($1,$2,$3)`,
      [randomUUID(), fixtureInstallation, `private-runner-${tag}`],
    );
    await probe.query(
      `INSERT INTO installation_component_credentials(installation_id,provider,credential_envelope)
        VALUES($1,'synthetic',$2)`,
      [fixtureInstallation, `private-credential-envelope-${tag}`],
    );
    await probe.query(
      `INSERT INTO installation_component_observations(id,installation_id,provider,mpn,status,source)
        VALUES($1,$2,'synthetic',$3,'unknown','synthetic')`,
      [randomUUID(), fixtureInstallation, `private-component-${tag}`],
    );
    await probe.query(
      `INSERT INTO audit_events(id,installation_id,event_type,actor_type,actor_id,actor_login,subject_type,subject_id,request_id,metadata)
        VALUES($1,$2,'installation.suspended','system','hidden-actor',$3,'installation',$4,$5,$6::jsonb)`,
      [
        tag === "owner" ? ownerInstallationAudit : foreignInstallationAudit,
        tag === "owner" ? sourceInstallationId : lookalikeInstallation,
        `hidden-inst-login-${tag}`,
        tag === "owner" ? sourceInstallationId : lookalikeInstallation,
        `hidden-inst-request-${tag}`,
        JSON.stringify({ privateAuditMetadata: `hidden-installation-${tag}` }),
      ],
    );
    await probe.query(
      `INSERT INTO audit_events(id,installation_id,event_type,actor_type,actor_id,actor_login,subject_type,subject_id,repository_id,release_run_id,request_id,metadata)
    VALUES($1,$2,'review.approved',$3,$4,$5,'review',$6,$7,$8,$9,$10::jsonb)`,
      [
        tag === "owner" ? ownerAudit : foreignAudit,
        tag === "owner" ? sourceInstallationId : lookalikeInstallation,
        `private_actor_type_${tag}`,
        `hidden-repo-actor-${tag}`,
        `hidden-repo-login-${tag}`,
        reviewId,
        repo,
        run,
        `hidden-repo-request-${tag}`,
        JSON.stringify({ privateAuditMetadata: `never-export-${tag}` }),
      ],
    );
  }
}

async function verifyHistoricalSourceEvidence(probe: HistoricalTestProbe, fixture: HistoricalSnapshotFixture) {
  const { exportId, ownerRepo, ownerRun, ownerFinding, lookalikeRepo } = fixture;
  const evidence = await prepareVerifiedHistoricalUserRunFindingSnapshot(probe, {
    exportId,
    verifiedGitHubUserId: accountUserId,
  });
  expect(evidence?.runCount).toBe(1);
  expect(evidence?.findingCount).toBe(1);
  expect(evidence?.sha256).toBe(
    createHash("sha256")
      .update(evidence?.bytes ?? Buffer.alloc(0))
      .digest("hex"),
  );
  const body = JSON.parse(evidence?.bytes.toString("utf8") ?? "{}");
  expect(body).toMatchObject({
    kind: "boardreadyops.historical-user-run-finding-preflight",
    completeCustomerExport: false,
    exportId,
  });
  expect(body.runs).toEqual([expect.objectContaining({ id: ownerRun, repositoryId: ownerRepo })]);
  expect(body.findings).toEqual([
    expect.objectContaining({ id: ownerFinding, runId: ownerRun, message: "private-finding-owner" }),
  ]);
  expect(JSON.stringify(body)).not.toContain("private-finding-foreign");
  expect(JSON.stringify(body)).not.toContain(lookalikeRepo);
  const combined = await prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
    exportId,
    verifiedGitHubUserId: accountUserId,
  });
  expect(combined).toMatchObject({
    repositoryCount: 1,
    runCount: 1,
    findingCount: 1,
    artifactCount: 1,
    reviewCount: 1,
    revisionCount: 1,
    auditCount: 1,
    installationAuditCount: expect.any(Number),
    commentCount: 1,
    approvalCount: 1,
    checklistCount: 1,
    findingDecisionCount: 1,
    findingAssignmentCount: 1,
    excludedSourceClassCounts: {
      runSnapshots: 1,
      apiTokens: 1,
      runnerRegistrations: 1,
      installationComponentCredentials: 1,
      installationComponentObservations: 1,
    },
  });
  expect(combined?.byteLength).toBe(combined?.bytes.byteLength);
  expect(combined?.sha256).toBe(
    createHash("sha256")
      .update(combined?.bytes ?? Buffer.alloc(0))
      .digest("hex"),
  );
  const combinedPayload = JSON.parse(combined?.bytes.toString("utf8") ?? "{}");
  return { combined, combinedPayload };
}

async function verifyHistoricalPrivacyRedactions(
  probe: HistoricalTestProbe,
  fixture: HistoricalSnapshotFixture,
  combined: Awaited<ReturnType<typeof prepareVerifiedHistoricalUserConsistentCorePreflight>>,
  combinedPayload: Awaited<ReturnType<typeof verifyHistoricalSourceEvidence>>["combinedPayload"],
): Promise<void> {
  const {
    exportId,
    ownerRepo,
    ownerRun,
    ownerFinding,
    ownerArtifact,
    ownerReview,
    ownerRevision,
    ownerComment,
    ownerApproval,
    ownerChecklist,
    ownerDecision,
    ownerAssignment,
    ownerInstallationAudit,
    ownerAudit,
  } = fixture;
  expect(combinedPayload).toMatchObject({
    kind: "boardreadyops.historical-user-consistent-core-preflight",
    completeCustomerExport: false,
    exportId,
  });
  expect(combinedPayload.repositories).toEqual([expect.objectContaining({ repositoryId: ownerRepo, disabled: true })]);
  expect(combinedPayload.runs).toEqual([expect.objectContaining({ id: ownerRun, repositoryId: ownerRepo })]);
  expect(combinedPayload.findings).toEqual([
    expect.objectContaining({ id: ownerFinding, runId: ownerRun, message: "" }),
  ]);
  expect(combinedPayload.excludedSourceClassCounts).toEqual({
    runSnapshots: 1,
    apiTokens: 1,
    runnerRegistrations: 1,
    installationComponentCredentials: 1,
    installationComponentObservations: 1,
  });
  expect(combinedPayload.exclusions).toContain("unverified-collaboration-and-finding-free-text");
  expect(combinedPayload.exclusions).toContain("unverified-repository-review-and-artifact-identifying-metadata");
  expect(combinedPayload.repositories[0]).toMatchObject({ owner: "", name: "" });
  expect(combinedPayload.runs[0].ref).toBe("");
  expect(combinedPayload.findings[0].path).toBeNull();
  expect(combinedPayload.artifacts[0].name).toBe("");
  expect(combinedPayload.reviewComments[0].evidenceAnchor).toBeNull();
  expect(JSON.stringify(combinedPayload)).not.toContain("sensitive-review-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-retained");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-finding-owner");
  expect(combinedPayload.exclusions).toEqual(
    expect.arrayContaining([
      "run-snapshot-private-visual-content",
      "api-token-hashes-prefixes-and-creator-identities",
      "runner-registration-identifiers",
      "installation-credential-envelopes",
      "installation-component-observation-data",
      "unverifiable-tenant-only-policy-and-billing-records",
    ]),
  );
  expect(combinedPayload.artifacts).toEqual([
    expect.objectContaining({
      id: ownerArtifact,
      runId: ownerRun,
      sha256: "d".repeat(64),
      byteLength: 512,
      retentionExpired: true,
      contentsVerified: false,
      downloadAvailable: false,
    }),
  ]);
  expect(combinedPayload.reviews).toEqual([
    expect.objectContaining({
      id: ownerReview,
      repositoryId: ownerRepo,
      headRunId: ownerRun,
      title: "",
    }),
  ]);
  expect(combinedPayload.revisions).toEqual([
    expect.objectContaining({
      id: ownerRevision,
      reviewId: ownerReview,
      headRunId: ownerRun,
      evidenceDigest: "b".repeat(64),
    }),
  ]);
  expect(combinedPayload.reviewComments).toEqual([
    expect.objectContaining({
      id: ownerComment,
      reviewId: ownerReview,
      repositoryId: ownerRepo,
      status: "open",
      content: "",
      contentIncluded: false,
      authorIdIncluded: false,
    }),
  ]);
  expect(combinedPayload.reviewApprovals).toEqual([
    expect.objectContaining({
      id: ownerApproval,
      reviewId: ownerReview,
      revisionId: ownerRevision,
      reason: null,
      invalidationReason: null,
      actorIncluded: false,
    }),
  ]);
  expect(combinedPayload.reviewChecklist).toEqual([
    expect.objectContaining({
      id: ownerChecklist,
      reviewId: ownerReview,
      completed: true,
      title: "",
      titleIncluded: false,
      completedByIncluded: false,
    }),
  ]);
  expect(combinedPayload.findingDecisions).toEqual([
    expect.objectContaining({
      id: ownerDecision,
      reviewId: ownerReview,
      repositoryId: ownerRepo,
      findingFingerprint: "finding-fingerprint-owner",
      disposition: "mitigated",
      reason: "",
      evidenceDigest: "c".repeat(64),
      ownerIncluded: false,
      actorIncluded: false,
    }),
  ]);
  expect(combinedPayload.findingAssignments).toEqual([
    expect.objectContaining({
      id: ownerAssignment,
      reviewId: ownerReview,
      repositoryId: ownerRepo,
      findingFingerprint: "finding-fingerprint-owner",
      assigneeIncluded: false,
      assignedByIncluded: false,
    }),
  ]);
  expect(combined?.installationAuditCount).toBeGreaterThanOrEqual(1);
  expect(combinedPayload.installationAuditEvents).toHaveLength(combined?.installationAuditCount ?? -1);
  expect(combinedPayload.installationAuditEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: ownerInstallationAudit,
        eventType: "installation.suspended",
        actorType: "system",
        subjectType: "installation",
        actorDetailsIncluded: false,
        subjectDetailsIncluded: false,
        requestIdIncluded: false,
        metadataIncluded: false,
      }),
    ]),
  );
  expect(combinedPayload.auditEvents).toEqual([
    expect.objectContaining({
      id: ownerAudit,
      repositoryId: ownerRepo,
      releaseRunId: ownerRun,
      eventType: "review.approved",
      actorType: "redacted",
      actorDetailsIncluded: false,
      subjectDetailsIncluded: false,
      requestIdIncluded: false,
      metadataIncluded: false,
    }),
  ]);
  expect(combined?.redactedAuditFieldCounts).toMatchObject({
    repositoryActorIdentities: 1,
    repositorySubjectIdentifiers: 1,
    repositoryRequestIdentifiers: 1,
    repositoryPrivateMetadata: 1,
  });
  expect(combinedPayload.redactedAuditFieldCounts).toEqual(combined?.redactedAuditFieldCounts);
  expect(combinedPayload.redactedAuditFieldCounts).toMatchObject({
    repositoryActorIdentities: 1,
    repositorySubjectIdentifiers: 1,
    repositoryRequestIdentifiers: 1,
    repositoryPrivateMetadata: 1,
  });
  for (const key of [
    "installationActorIdentities",
    "installationSubjectIdentifiers",
    "installationRequestIdentifiers",
    "installationPrivateMetadata",
  ])
    expect(combinedPayload.redactedAuditFieldCounts[key]).toBeGreaterThanOrEqual(1);
  await verifyHistoricalNoLeakage(probe, fixture, combinedPayload);
}

async function verifyHistoricalNoLeakage(
  probe: HistoricalTestProbe,
  fixture: HistoricalSnapshotFixture,
  combinedPayload: Awaited<ReturnType<typeof verifyHistoricalSourceEvidence>>["combinedPayload"],
): Promise<void> {
  const {
    sourceInstallationId,
    lookalikeRepo,
    foreignArtifact,
    foreignReview,
    foreignRevision,
    ownerComment,
    foreignComment,
    foreignApproval,
    foreignChecklist,
    foreignDecision,
    foreignAssignment,
    foreignInstallationAudit,
    foreignAudit,
  } = fixture;
  for (const owner of ["owner", "foreign"]) {
    for (const confidential of [
      `hidden-inst-login-${owner}`,
      `hidden-inst-request-${owner}`,
      `hidden-repo-actor-${owner}`,
      `hidden-repo-login-${owner}`,
      `hidden-repo-request-${owner}`,
      `private_actor_type_${owner}`,
    ])
      expect(JSON.stringify(combinedPayload)).not.toContain(confidential);
  }
  expect(JSON.stringify(combinedPayload)).not.toContain("private-comment-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-comment-foreign");
  const storedComment = await probe.query("SELECT content FROM review_comments WHERE id=$1", [ownerComment]);
  expect((storedComment as { rows?: Array<{ content: string }> }).rows?.[0]?.content).toBe("private-comment-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-title-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-approval-reason-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-approval-reason-foreign");
  expect(JSON.stringify(combinedPayload)).not.toContain("reviewer-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-finding-decision-reason-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-finding-decision-reason-foreign");
  expect(JSON.stringify(combinedPayload)).not.toContain("secret-finding-owner-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("secret-finding-actor-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-finding-assignee-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("private-assigned-by-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignDecision);
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignAssignment);
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignComment);
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignApproval);
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignChecklist);
  expect(JSON.stringify(combinedPayload)).not.toContain("hidden-actor");
  expect(JSON.stringify(combinedPayload)).not.toContain("hidden-installation-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("hidden-installation-foreign");
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignInstallationAudit);
  expect(JSON.stringify(combinedPayload)).not.toContain(sourceInstallationId);
  expect(JSON.stringify(combinedPayload)).not.toContain("never-export-owner");
  expect(JSON.stringify(combinedPayload)).not.toContain("never-export-foreign");
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignReview);
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignRevision);
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignAudit);
  expect(JSON.stringify(combinedPayload)).not.toContain("secret/internal/");
  expect(JSON.stringify(combinedPayload)).not.toContain(lookalikeRepo);
  for (const tag of ["owner", "foreign"]) {
    for (const protectedValue of [
      `private-kicad-design-${tag}`,
      `private-api-token-${tag}`,
      `secret-prefix-${tag}`,
      `private-runner-${tag}`,
      `private-credential-envelope-${tag}`,
      `private-component-${tag}`,
    ])
      expect(JSON.stringify(combinedPayload)).not.toContain(protectedValue);
  }
  expect(JSON.stringify(combinedPayload)).not.toContain("private-finding-foreign");
  expect(JSON.stringify(combinedPayload)).not.toContain(foreignArtifact);
}

async function verifyHistoricalAdversarialCases(
  probe: HistoricalTestProbe,
  fixture: HistoricalSnapshotFixture,
): Promise<void> {
  const { exportId, sourceInstallationId, ownerRepo, ownerRun, foreignReview, crossAudit } = fixture;
  // A known sensitive source class above 100 must not be silently
  // truncated into an apparently complete source inventory.
  await probe.query(
    `INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256)
        SELECT gen_random_uuid()::text,$1,'overflow-'||i,'private-overflow-'||i,
               'pcb_layer','svg','F.Cu',100,80,'<svg>hidden</svg>',$2
          FROM generate_series(1,101) AS i`,
    [ownerRun, "7".repeat(64)],
  );
  await expect(
    prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
      exportId,
      verifiedGitHubUserId: accountUserId,
    }),
  ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
  await probe.query("DELETE FROM run_snapshots WHERE run_id=$1 AND snapshot_id LIKE 'overflow-%'", [ownerRun]);
  // Repository-linked audit pointing at a foreign review must fail closed,
  // even though the DB permits an opaque subject id without a review FK.
  await probe.query(
    `INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type,subject_id,repository_id,release_run_id)
  VALUES($1,$2,'review.approved','system','review',$3,$4,$5)`,
    [crossAudit, sourceInstallationId, foreignReview, ownerRepo, ownerRun],
  );
  await expect(
    prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
      exportId,
      verifiedGitHubUserId: accountUserId,
    }),
  ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
  expect(
    await prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
      exportId,
      verifiedGitHubUserId: accountUserId + 99,
    }),
  ).toBeNull();
  expect(
    await prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
      exportId: "../unsafe",
      verifiedGitHubUserId: accountUserId,
    }),
  ).toBeNull();
  expect(
    await prepareVerifiedHistoricalUserRunFindingSnapshot(probe, {
      exportId,
      verifiedGitHubUserId: accountUserId + 99,
    }),
  ).toBeNull();
  expect(
    await prepareVerifiedHistoricalUserRunFindingSnapshot(probe, {
      exportId: "../unsafe",
      verifiedGitHubUserId: accountUserId,
    }),
  ).toBeNull();
}

describeDatabase("immutable GitHub original-account evidence after user App uninstall", () => {
  it("persists stable account ID and creates one identity-bound uninstalled user-scope export", async () => {
    const lifecycle = store();
    await lifecycle.upsertInstallation(
      { type: "installation.upsert", installation },
      {
        deliveryId: `historical-install-${randomUUID()}`,
        eventType: "installation",
        eventAction: "created",
      },
    );
    const before = rows(
      await executor().query(
        "SELECT id,account_login,account_user_id,suspended_at FROM installations WHERE github_installation_id=$1",
        [externalInstallationId],
      ),
    )[0];
    expect(before).toMatchObject({
      account_login: login,
      account_user_id: String(accountUserId),
      suspended_at: null,
    });

    // Refresh without account.id must never strip the established identity.
    await lifecycle.upsertInstallation({
      type: "installation.upsert",
      installation: {
        id: externalInstallationId,
        accountLogin: login,
        accountType: "User",
      },
    });
    expect(
      rows(
        await executor().query("SELECT account_user_id FROM installations WHERE github_installation_id=$1", [
          externalInstallationId,
        ]),
      )[0]?.account_user_id,
    ).toBe(String(accountUserId));

    // An unexpected conflicting identity must never overwrite the installation owner.
    await lifecycle.upsertInstallation({
      type: "installation.upsert",
      installation: {
        ...installation,
        accountUserId: accountUserId + 1,
        accountLogin: "new-same-name",
      },
    });
    expect(
      rows(
        await executor().query(
          "SELECT account_login,account_user_id FROM installations WHERE github_installation_id=$1",
          [externalInstallationId],
        ),
      )[0],
    ).toEqual({ account_login: login, account_user_id: String(accountUserId) });

    await lifecycle.deleteInstallation(
      { type: "installation.deleted", installation },
      {
        deliveryId: `historical-delete-${randomUUID()}`,
        eventType: "installation",
        eventAction: "deleted",
      },
    );
    const bound = rows(
      await executor().query(
        `SELECT id,tenant_id,scope,scope_id,installation_id,
              original_github_user_id,download_url
         FROM data_exports
        WHERE tenant_id=$1 AND requested_by='github_app_uninstall'`,
        [login],
      ),
    );
    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({
      tenant_id: login,
      scope: "user",
      scope_id: login,
      installation_id: null,
      original_github_user_id: String(accountUserId),
      download_url: null,
    });
    const id = String(bound[0]?.id);
    const recover = new DataLifecycleStore(executor());
    expect(
      await recover.getVerifiedHistoricalUserExport({
        exportId: id,
        verifiedGitHubUserId: accountUserId,
      }),
    ).toMatchObject({
      id,
      tenantId: login,
      requestedBy: "github_app_uninstall",
      scope: "user",
      scopeId: login,
      status: "pending",
      downloadUrl: null,
    });
    // Historical status must not reactivate the removed installation.
    expect(
      rows(
        await executor().query("SELECT suspended_at FROM installations WHERE github_installation_id=$1", [
          externalInstallationId,
        ]),
      )[0]?.suspended_at,
    ).toBeInstanceOf(Date);
    expect(await recover.getExport(login, id, String(before?.id))).toBeNull();
    expect(
      await recover.getVerifiedHistoricalUserExport({
        exportId: id,
        verifiedGitHubUserId: accountUserId + 1,
      }),
    ).toBeNull();
    expect(
      await recover.getVerifiedHistoricalUserExport({
        exportId: id,
        verifiedGitHubUserId: -1,
      }),
    ).toBeNull();
    expect(
      await recover.getVerifiedHistoricalUserExport({
        exportId: "../not-an-export",
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
  });

  it("bounds real FK-linked historical original USER source rows without returning private content", async () => {
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const exportId = String(exportRow?.id);
    const review = await assessHistoricalUserUnresolvedOwnerRows(executor(), {
      exportId,
      verifiedGitHubUserId: accountUserId,
    });
    expect(review).toMatchObject({
      status: "bounded-source-row-fk-candidates-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      reviewedClasses: 63,
    });
    expect((review?.linkedRowCounts.length ?? 0) + (review?.ambiguousFkPathClasses.length ?? 0)).toBe(34);
    // Parallel FKs can be bypassed by a stronger unambiguous required path;
    // only paths ACTUALLY selected by the catalog walk are marked ambiguous.
    expect(new Set(review?.linkedRowCounts.map((item) => item.table)).size).toBe(review?.linkedRowCounts.length);
    expect(review?.noInstallationPath).toHaveLength(29);
    expect(review?.noInstallationPath).toContain("data_exports");
    expect(review?.linkedRowCounts.find((item) => item.table === "installations")?.boundedLinkedRows).toBeGreaterThan(
      0,
    );
    expect(review?.linkedRowCounts.every((item) => item.boundedLinkedRows <= 100)).toBe(true);
    expect(review?.linkedRowCounts.every((item) => /^[0-9a-f]{64}$/u.test(item.rowMultisetSha256))).toBe(true);
    expect(JSON.stringify(review)).not.toContain(login);
    expect(JSON.stringify(review)).not.toContain(exportId);

    // An unknown numeric USER cannot borrow the original one's installation
    // simply by supplying the right export ID.
    expect(
      await assessHistoricalUserUnresolvedOwnerRows(executor(), {
        exportId,
        verifiedGitHubUserId: accountUserId + 1,
      }),
    ).toBeNull();
  });

  it("changes its private source-row multiset commitment for count-preserving row edits", async () => {
    const originalInstallation = rows(
      await executor().query("SELECT id,account_login FROM installations WHERE github_installation_id=$1", [
        externalInstallationId,
      ]),
    )[0];
    const installationId = String(originalInstallation?.id);
    const originalLogin = String(originalInstallation?.account_login);
    expect(installationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(originalLogin).toBe(login);
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const binding = { exportId: String(exportRow?.id), verifiedGitHubUserId: accountUserId };
    const before = await assessHistoricalUserUnresolvedOwnerRows(executor(), binding);
    expect(before).not.toBeNull();
    try {
      // Case-only edit preserves account linkage under lower(...) and
      // leaves every row count unchanged, but must alter its source digest.
      await executor().query("UPDATE installations SET account_login=UPPER(account_login) WHERE id=$1", [
        installationId,
      ]);
      const after = await assessHistoricalUserUnresolvedOwnerRows(executor(), binding);
      expect(after).not.toBeNull();
      const oldInstallation = before?.linkedRowCounts.find((item) => item.table === "installations");
      const newInstallation = after?.linkedRowCounts.find((item) => item.table === "installations");
      expect(oldInstallation?.boundedLinkedRows).toBe(newInstallation?.boundedLinkedRows);
      expect(oldInstallation?.rowMultisetSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(newInstallation?.rowMultisetSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(newInstallation?.rowMultisetSha256).not.toBe(oldInstallation?.rowMultisetSha256);
      expect(after?.customerDeliveryAllowed).toBe(false);
    } finally {
      await executor().query("UPDATE installations SET account_login=$2 WHERE id=$1", [installationId, originalLogin]);
    }
  });

  it("stops all historical original-user source reads on expiry, active hold and non-dry-run erasure", async () => {
    const exportRow = rows(
      await executor().query(
        "SELECT id,expires_at FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1",
        [login, accountUserId],
      ),
    )[0];
    const exportId = String(exportRow?.id);
    const oldExpiry = exportRow?.expires_at ?? null;
    const input = { exportId, verifiedGitHubUserId: accountUserId };
    const holdId = randomUUID();
    const erasureId = randomUUID();
    const readAll = async () =>
      Promise.all([
        prepareVerifiedHistoricalUserRepositoryInventory(executor(), input),
        prepareVerifiedHistoricalUserRunFindingSnapshot(executor(), input),
        prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), input),
        prepareVerifiedHistoricalUserPrivateVisualEvidence(executor(), input),
        prepareVerifiedHistoricalUserCompositePreflight(executor(), input),
        assessHistoricalUserUnresolvedOwnerRows(executor(), input),
      ]);
    const denyAll = async () => {
      expect(await readAll()).toEqual([null, null, null, null, null, null]);
    };
    try {
      // A pending record is not enough authority once its deadline passed.
      await executor().query("UPDATE data_exports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [exportId]);
      await denyAll();
      await executor().query("UPDATE data_exports SET expires_at=$2 WHERE id=$1", [exportId, oldExpiry]);
      expect((await readAll()).every((candidate) => candidate !== null)).toBe(true);

      await executor().query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','early snapshot retention fence','user',$2)",
        [holdId, login],
      );
      await denyAll();
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);

      // Dry-run requests do not block; an actual running erasure does.
      await executor().query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',TRUE)",
        [erasureId, login],
      );
      expect((await readAll()).every((candidate) => candidate !== null)).toBe(true);
      await executor().query("UPDATE erasure_requests SET dry_run=FALSE WHERE id=$1", [erasureId]);
      await denyAll();
      await executor().query("UPDATE erasure_requests SET status='completed',completed_at=NOW() WHERE id=$1", [
        erasureId,
      ]);
      await denyAll();
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
      await executor().query("UPDATE data_exports SET expires_at=$2 WHERE id=$1", [exportId, oldExpiry]);
    }
    expect((await readAll()).every((candidate) => candidate !== null)).toBe(true);
  });

  it("preflights only retained suspended repositories of the same immutable historical user, never a login lookalike", async () => {
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const exportId = String(exportRow?.id);
    const originalInstallation = rows(
      await executor().query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
    )[0];
    const originalId = String(originalInstallation?.id);
    const privateId = randomUUID();
    const disabledId = randomUUID();
    const foreignInstallation = randomUUID();
    const foreignRepo = randomUUID();
    const baseRepo = 5_000_000_000 + Math.floor(Math.random() * 100_000);
    try {
      await executor().query(
        `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,private,default_branch,disabled_at)
         VALUES ($1,$2,$3,$4,'private-retained',TRUE,'main',NULL),
                ($5,$2,$6,$4,'disabled-retained',FALSE,'main',NOW())`,
        [privateId, originalId, baseRepo, login, disabledId, baseRepo + 1],
      );
      await executor().query(
        `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
         VALUES ($1,$2,$3,'User',$4,NOW())`,
        [foreignInstallation, externalInstallationId + 5_000_000, login, accountUserId + 1],
      );
      await executor().query(
        `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
         VALUES ($1,$2,$3,$4,'lookalike-repo','main')`,
        [foreignRepo, foreignInstallation, baseRepo + 2, login],
      );
      const inventory = await prepareVerifiedHistoricalUserRepositoryInventory(executor(), {
        exportId,
        verifiedGitHubUserId: accountUserId,
      });
      expect(inventory).not.toBeNull();
      expect(inventory?.repositoryCount).toBe(2);
      expect(inventory?.byteLength).toBe(inventory?.bytes.byteLength);
      expect(
        createHash("sha256")
          .update(inventory?.bytes ?? Buffer.alloc(0))
          .digest("hex"),
      ).toBe(inventory?.sha256);
      const payload = JSON.parse(inventory?.bytes.toString("utf8") ?? "{}");
      expect(payload).toMatchObject({
        kind: "boardreadyops.historical-user-repository-preflight",
        coverage: "retained-suspended-user-installation-repositories-only",
        completeCustomerExport: false,
        exportId,
      });
      expect(payload.repositories).toHaveLength(2);
      expect(new Set(payload.repositories.map((repo: { repositoryId: string }) => repo.repositoryId))).toEqual(
        new Set([privateId, disabledId]),
      );
      expect(payload.repositories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ repositoryId: privateId, private: true, disabled: false }),
          expect.objectContaining({ repositoryId: disabledId, private: false, disabled: true }),
        ]),
      );
      expect(JSON.stringify(payload)).not.toContain(foreignRepo);
      const combined = await prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
        exportId,
        verifiedGitHubUserId: accountUserId,
      });
      expect(combined).toMatchObject({
        repositoryCount: 2,
        runCount: 0,
        findingCount: 0,
      });
      expect(combined?.sha256).toBe(
        createHash("sha256")
          .update(combined?.bytes ?? Buffer.alloc(0))
          .digest("hex"),
      );
      const combinedPayload = JSON.parse(combined?.bytes.toString("utf8") ?? "{}");
      expect(combinedPayload).toMatchObject({
        kind: "boardreadyops.historical-user-consistent-core-preflight",
        completeCustomerExport: false,
        exportId,
        runs: [],
        findings: [],
      });
      expect(new Set(combinedPayload.repositories.map((repo: { repositoryId: string }) => repo.repositoryId))).toEqual(
        new Set([privateId, disabledId]),
      );
      expect(JSON.stringify(combinedPayload)).not.toContain(foreignRepo);
      expect(
        await prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId + 1,
        }),
      ).toBeNull();
      expect(
        await prepareVerifiedHistoricalUserRepositoryInventory(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId + 1,
        }),
      ).toBeNull();
      expect(
        await prepareVerifiedHistoricalUserRepositoryInventory(executor(), {
          exportId: "../bad",
          verifiedGitHubUserId: accountUserId,
        }),
      ).toBeNull();
    } finally {
      await executor().query("DELETE FROM repositories WHERE id=ANY($1::text[])", [
        [privateId, disabledId, foreignRepo],
      ]);
      await executor().query("DELETE FROM installations WHERE id=$1", [foreignInstallation]);
    }
  });

  it("snapshots only the verified former user's retained runs and findings, never a recycled login's evidence", async () => {
    const rollback = "rollback-historical-review-audit-fixture";
    await expect(
      executor().withTransaction(async (tx) => {
        // Keep all sensitive fixtures in one DB transaction. The nested
        // snapshots execute on this same connection; the terminal marker
        // rolls back inserts, including immutable audit rows.
        const probe = {
          query: tx.query,
          withTransaction: <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => work(tx),
        };
        const exportRow = rows(
          await probe.query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
            login,
            accountUserId,
          ]),
        )[0];
        const former = rows(
          await probe.query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
        )[0];
        const exportId = String(exportRow?.id);
        const sourceInstallationId = String(former?.id);
        const fixture = makeHistoricalSnapshotFixture(exportId, sourceInstallationId);
        {
          await seedHistoricalSnapshotFixtures(probe, fixture);
          const { combined, combinedPayload } = await verifyHistoricalSourceEvidence(probe, fixture);
          await verifyHistoricalPrivacyRedactions(probe, fixture, combined, combinedPayload);
          await verifyHistoricalAdversarialCases(probe, fixture);
        }
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("checks only the original numeric USER private SVG digests, without exposing design content or recycled-login data", async () => {
    const rollback = "rollback-original-user-private-visual-evidence";
    await expect(
      executor().withTransaction(async (tx) => {
        const probe = {
          query: tx.query,
          withTransaction: <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => work(tx),
        };
        const exportRow = rows(
          await tx.query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
            login,
            accountUserId,
          ]),
        )[0];
        const former = rows(
          await tx.query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
        )[0];
        const exportId = String(exportRow?.id);
        const ownerInstallId = String(former?.id);
        const otherInstallId = randomUUID();
        const ownRepo = randomUUID();
        const foreignRepo = randomUUID();
        const ownRun = randomUUID();
        const foreignRun = randomUUID();
        const ownVisual = randomUUID();
        const foreignVisual = randomUUID();
        const ownSvg = "<svg xmlns='http://www.w3.org/2000/svg'>private-original-board</svg>";
        const foreignSvg = "<svg>foreign-recycled-login-schematic</svg>";
        const ownHash = createHash("sha256").update(ownSvg).digest("hex");
        const foreignHash = createHash("sha256").update(foreignSvg).digest("hex");
        const n = 98_000_000_000 + Math.floor(Math.random() * 100_000);
        await tx.query(
          "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
          [otherInstallId, externalInstallationId + 9_000_000, login, accountUserId + 199],
        );
        await tx.query(
          "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'private-owner','main'),($5,$6,$7,$4,'private-other','main')",
          [ownRepo, ownerInstallId, n, login, foreignRepo, otherInstallId, n + 1],
        );
        await tx.query(
          "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed'),($4,$5,$3,'refs/heads/main','manual','completed')",
          [ownRun, ownRepo, "a".repeat(40), foreignRun, foreignRepo],
        );
        await tx.query(
          "INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256) VALUES($1,$2,'own-visual','owner.svg','pcb_layer','svg','F.Cu',100,80,$3,$4),($5,$6,'foreign-visual','other.svg','pcb_layer','svg','F.Cu',100,80,$7,$8)",
          [ownVisual, ownRun, ownSvg, ownHash, foreignVisual, foreignRun, foreignSvg, foreignHash],
        );
        const check = () =>
          prepareVerifiedHistoricalUserPrivateVisualEvidence(probe, {
            exportId,
            verifiedGitHubUserId: accountUserId,
          });
        const evidence = await check();
        expect(evidence?.visualCount).toBe(1);
        expect(evidence?.sha256).toBe(
          createHash("sha256")
            .update(evidence?.bytes ?? Buffer.alloc(0))
            .digest("hex"),
        );
        const body = JSON.parse(evidence?.bytes.toString("utf8") ?? "{}");
        expect(body).toMatchObject({
          kind: "boardreadyops.historical-user-private-visual-evidence-preflight",
          completeCustomerExport: false,
          contentIncluded: false,
        });
        expect(body.visuals).toEqual([
          expect.objectContaining({
            id: ownVisual,
            runId: ownRun,
            repositoryId: ownRepo,
            sha256: ownHash,
            byteLength: Buffer.byteLength(ownSvg),
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain("own-visual");
        expect(JSON.stringify(body)).not.toContain("private-original-board");
        expect(JSON.stringify(body)).not.toContain("foreign-recycled-login-schematic");
        expect(JSON.stringify(body)).not.toContain(foreignVisual);
        expect(
          await prepareVerifiedHistoricalUserPrivateVisualEvidence(probe, {
            exportId,
            verifiedGitHubUserId: accountUserId + 199,
          }),
        ).toBeNull();
        await tx.query("UPDATE run_snapshots SET sha256=$1 WHERE id=$2", ["f".repeat(64), ownVisual]);
        await expect(check()).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
        await tx.query("UPDATE run_snapshots SET sha256=$1,format='png' WHERE id=$2", [ownHash, ownVisual]);
        await expect(check()).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
        await tx.query("UPDATE run_snapshots SET format='svg',content=$1 WHERE id=$2", ["x".repeat(262145), ownVisual]);
        await expect(check()).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
        await tx.query("UPDATE run_snapshots SET content=$1 WHERE id=$2", [ownSvg, ownVisual]);
        expect((await check())?.visualCount).toBe(1);
        await tx.query(
          "INSERT INTO run_snapshots(id,run_id,snapshot_id,name,kind,format,sheet_or_layer,width,height,content,sha256) SELECT gen_random_uuid()::text,$1,'extra-'||i,'extra.svg','pcb_layer','svg','F.Cu',100,80,$2,$3 FROM generate_series(1,101) AS i",
          [ownRun, ownSvg, ownHash],
        );
        await expect(check()).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("rejects overflowing historical review and audit descriptors without weakening immutable audit history", async () => {
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const former = rows(
      await executor().query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
    )[0];
    const exportId = String(exportRow?.id);
    const installationId = String(former?.id);
    const repositoryId = randomUUID();
    const runId = randomUUID();
    const repoNumber = 8_750_000_000 + Math.floor(Math.random() * 100_000);
    const rollback = "rollback-review-audit-overflow";
    await expect(
      executor().withTransaction(async (tx) => {
        const probe = {
          query: tx.query,
          withTransaction: <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => work(tx),
        };
        await tx.query(
          `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
         VALUES($1,$2,$3,$4,'review-audit-overflow','main')`,
          [repositoryId, installationId, repoNumber, login],
        );
        await tx.query(
          `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
         VALUES($1,$2,$3,'refs/heads/main','manual','completed')`,
          [runId, repositoryId, "a".repeat(40)],
        );
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
         SELECT gen_random_uuid()::text,$1,'overflow-review-'||i,'completed','approved',$2
           FROM generate_series(1,101) AS i`,
          [repositoryId, runId],
        );
        await expect(
          prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
            exportId,
            verifiedGitHubUserId: accountUserId,
          }),
        ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
        await tx.query("DELETE FROM reviews WHERE repository_id=$1", [repositoryId]);
        // Append-only audit records are never DELETEd; rollback is the only
        // fixture cleanup, with no trigger relaxation or production changes.
        await tx.query(
          `INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type,repository_id,release_run_id)
         SELECT gen_random_uuid()::text,$1,'review.approved','system','run',$2,$3
           FROM generate_series(1,101)`,
          [installationId, repositoryId, runId],
        );
        await expect(
          prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
            exportId,
            verifiedGitHubUserId: accountUserId,
          }),
        ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("quarantines inconsistent historical collaboration references and unbounded comments", async () => {
    const rollback = "rollback-historical-collaboration-adversarial";
    await expect(
      executor().withTransaction(async (tx) => {
        const probe = {
          query: tx.query,
          withTransaction: <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => work(tx),
        };
        const exportRow = rows(
          await tx.query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
            login,
            accountUserId,
          ]),
        )[0];
        const former = rows(
          await tx.query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
        )[0];
        const exportId = String(exportRow?.id);
        const repoId = randomUUID();
        const runId = randomUUID();
        const reviewId = randomUUID();
        const revisionId = randomUUID();
        await tx.query(
          `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
           VALUES($1,$2,$3,$4,'collaboration-isolation','main')`,
          [repoId, String(former?.id), 9_400_000_000 + Math.floor(Math.random() * 100_000), login],
        );
        await tx.query(
          `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
           VALUES($1,$2,$3,'refs/heads/main','manual','completed')`,
          [runId, repoId, "a".repeat(40)],
        );
        await tx.query(
          `INSERT INTO reviews(id,repository_id,title,status,decision,head_run_id)
           VALUES($1,$2,'collaboration-isolation','completed','approved',$3)`,
          [reviewId, repoId, runId],
        );
        await tx.query(
          `INSERT INTO review_revisions(id,review_id,sequence,head_run_id,head_commit_sha,evidence_digest)
           VALUES($1,$2,1,$3,$4,$5)`,
          [revisionId, reviewId, runId, "a".repeat(40), "b".repeat(64)],
        );
        const check = () =>
          prepareVerifiedHistoricalUserConsistentCorePreflight(probe, {
            exportId,
            verifiedGitHubUserId: accountUserId,
          });
        expect((await check())?.reviewCount).toBe(1);
        for (const sqlAndArgs of [
          {
            sql: `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
                  VALUES($1,$2,$3,'trusted','hidden')`,
            args: [randomUUID(), randomUUID(), reviewId],
          },
          {
            sql: `INSERT INTO review_approvals(id,repository_id,review_id,revision_id,evidence_digest,approver_id,status)
                  VALUES($1,$2,$3,$4,$5,'trusted','approved')`,
            args: [randomUUID(), repoId, reviewId, randomUUID(), "b".repeat(64)],
          },
          {
            sql: `INSERT INTO review_checklist_items(id,repository_id,review_id,title,completed)
                  VALUES($1,$2,$3,'hidden',TRUE)`,
            args: [randomUUID(), randomUUID(), reviewId],
          },
          {
            sql: `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
                  VALUES($1,$2,$3,'trusted',$4)`,
            args: [randomUUID(), repoId, reviewId, "🚀".repeat(3000)],
          },
          {
            sql: `INSERT INTO review_checklist_items(id,repository_id,review_id,title)
                  VALUES($1,$2,$3,$4)`,
            args: [randomUUID(), repoId, reviewId, "🚀".repeat(3000)],
          },
          {
            sql: `INSERT INTO review_approvals(id,repository_id,review_id,revision_id,evidence_digest,approver_id,status,reason)
                  VALUES($1,$2,$3,$4,$5,'trusted','approved',$6)`,
            args: [randomUUID(), repoId, reviewId, revisionId, "b".repeat(64), "🚀".repeat(3000)],
          },
          {
            // A child may point at an owned review while asserting another
            // repository ID: the DB does not enforce that relationship.
            sql: `INSERT INTO finding_decisions
                  (id,repository_id,review_id,finding_fingerprint,disposition,reason,owner,evidence_digest,actor_id)
                  VALUES($1,$2,$3,'fingerprint','mitigated','private',$4,$5,'actor')`,
            args: [`fdec_${randomUUID()}`, randomUUID(), reviewId, "someone", "c".repeat(64)],
          },
          {
            sql: `INSERT INTO finding_assignments
                  (id,repository_id,review_id,finding_fingerprint,assignee,assigned_by)
                  VALUES($1,$2,$3,'fingerprint','someone','actor')`,
            args: [`fasn_${randomUUID()}`, randomUUID(), reviewId],
          },
          {
            // Unicode UTF-8 byte count, not character count.
            sql: `INSERT INTO finding_decisions
                  (id,repository_id,review_id,finding_fingerprint,disposition,reason,owner,evidence_digest,actor_id)
                  VALUES($1,$2,$3,'fingerprint','mitigated',$4,'someone',$5,'actor')`,
            args: [`fdec_${randomUUID()}`, repoId, reviewId, "🚀".repeat(1100), "c".repeat(64)],
          },
          {
            sql: `INSERT INTO finding_assignments
                  (id,repository_id,review_id,finding_fingerprint,assignee,assigned_by)
                  VALUES($1,$2,$3,$4,'someone','actor')`,
            args: [`fasn_${randomUUID()}`, repoId, reviewId, "🚀".repeat(550)],
          },
          {
            // A bounded snapshot must not silently drop item 101.
            sql: `INSERT INTO finding_decisions
                  (id,repository_id,review_id,finding_fingerprint,disposition,reason,owner,evidence_digest,actor_id)
                  SELECT 'fdec_'||gen_random_uuid()::text,$1,$2,'fingerprint-'||i,'mitigated',
                         'bounded','someone',$3,'actor'
                    FROM generate_series(1,101) AS i`,
            args: [repoId, reviewId, "c".repeat(64)],
          },
          {
            sql: `INSERT INTO finding_assignments
                  (id,repository_id,review_id,finding_fingerprint,assignee,assigned_by)
                  SELECT 'fasn_'||gen_random_uuid()::text,$1,$2,'fingerprint-'||i,
                         'assignee-'||i,'actor'
                    FROM generate_series(1,101) AS i`,
            args: [repoId, reviewId],
          },
          {
            sql: `INSERT INTO review_comments(id,repository_id,review_id,author_id,content)
                  SELECT gen_random_uuid()::text,$1,$2,'trusted','bulk'
                    FROM generate_series(1,101)`,
            args: [repoId, reviewId],
          },
          {
            sql: `INSERT INTO audit_events(id,installation_id,event_type,actor_type,subject_type)
                  SELECT gen_random_uuid()::text,$1,'installation.suspended','system','installation'
                    FROM generate_series(1,101)`,
            args: [String(former?.id)],
          },
        ]) {
          await tx.query("SAVEPOINT malicious_review");
          await tx.query(sqlAndArgs.sql, sqlAndArgs.args);
          await expect(check()).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
          await tx.query("ROLLBACK TO SAVEPOINT malicious_review");
          await tx.query("RELEASE SAVEPOINT malicious_review");
        }
        expect((await check())?.commentCount).toBe(0);
        expect((await check())?.findingDecisionCount).toBe(0);
        expect((await check())?.findingAssignmentCount).toBe(0);
        throw new Error(rollback);
      }),
    ).rejects.toThrow(rollback);
  });

  it("rejects more than 100 historical artifacts rather than publishing a truncated or unverified set", async () => {
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const former = rows(
      await executor().query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
    )[0];
    const repositoryId = randomUUID();
    const runId = randomUUID();
    const repoNumber = 8_500_000_000 + Math.floor(Math.random() * 100_000);
    try {
      await executor().query(
        `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
         VALUES($1,$2,$3,$4,'artifact-overflow-test','main')`,
        [repositoryId, String(former?.id), repoNumber, login],
      );
      await executor().query(
        `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
         VALUES($1,$2,$3,'refs/heads/main','manual','completed')`,
        [runId, repositoryId, "f".repeat(40)],
      );
      await executor().query(
        `INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type)
         SELECT gen_random_uuid()::text,$1,'manufacturing','object-'||i,'package',
                'not-exported-path-'||i,$2,128,'application/zip'
         FROM generate_series(1,101) AS i`,
        [runId, "e".repeat(64)],
      );
      await expect(
        prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
          exportId: String(exportRow?.id),
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
    } finally {
      await executor().query("DELETE FROM artifacts WHERE run_id=$1", [runId]);
      await executor().query("DELETE FROM release_runs WHERE id=$1", [runId]);
      await executor().query("DELETE FROM repositories WHERE id=$1", [repositoryId]);
    }
  });

  it("rejects historical run and finding overflows without publishing a truncated snapshot", async () => {
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const former = rows(
      await executor().query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
    )[0];
    const exportId = String(exportRow?.id);
    const sourceId = String(former?.id);
    const repositoryId = randomUUID();
    const seedRun = randomUUID();
    const repoNumber = 9_000_000_000 + Math.floor(Math.random() * 100_000);
    try {
      await executor().query(
        `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
         VALUES($1,$2,$3,$4,'overflow-evidence','main')`,
        [repositoryId, sourceId, repoNumber, login],
      );
      await executor().query(
        `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
         SELECT gen_random_uuid()::text,$1,$2,'refs/heads/main','manual','completed'
         FROM generate_series(1,101)`,
        [repositoryId, "b".repeat(40)],
      );
      await expect(
        prepareVerifiedHistoricalUserRunFindingSnapshot(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
      await expect(
        prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
      await executor().query("DELETE FROM release_runs WHERE repository_id=$1", [repositoryId]);
      await executor().query(
        `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
         VALUES($1,$2,$3,'refs/heads/main','manual','completed')`,
        [seedRun, repositoryId, "b".repeat(40)],
      );
      await executor().query(
        `INSERT INTO findings(id,run_id,rule_id,severity,message,path,kind)
         SELECT gen_random_uuid()::text,$1,'rule-'||i,'warning','overflow-finding','board.kicad_pcb','erc'
         FROM generate_series(1,101) AS i`,
        [seedRun],
      );
      await expect(
        prepareVerifiedHistoricalUserRunFindingSnapshot(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
      await expect(
        prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
    } finally {
      await executor().query(
        "DELETE FROM findings WHERE run_id IN (SELECT id FROM release_runs WHERE repository_id=$1)",
        [repositoryId],
      );
      await executor().query("DELETE FROM release_runs WHERE repository_id=$1", [repositoryId]);
      await executor().query("DELETE FROM repositories WHERE id=$1", [repositoryId]);
    }
  });

  it("fails the whole preflight when more than 100 retained repositories are present rather than truncating", async () => {
    const exportRow = rows(
      await executor().query("SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id=$2 LIMIT 1", [
        login,
        accountUserId,
      ]),
    )[0];
    const installationRow = rows(
      await executor().query("SELECT id FROM installations WHERE github_installation_id=$1", [externalInstallationId]),
    )[0];
    const exportId = String(exportRow?.id);
    const installationId = String(installationRow?.id);
    const base = 7_000_000_000 + Math.floor(Math.random() * 100_000);
    try {
      await executor().query(
        `INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch)
         SELECT gen_random_uuid()::text,$1,$2::bigint+item,$3,'bounded-'||item::text,'main'
           FROM generate_series(1,101) AS item`,
        [installationId, base, login],
      );
      await expect(
        prepareVerifiedHistoricalUserRepositoryInventory(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
      await expect(
        prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
          exportId,
          verifiedGitHubUserId: accountUserId,
        }),
      ).rejects.toBeInstanceOf(HistoricalUserInventoryUnavailableError);
    } finally {
      await executor().query("DELETE FROM repositories WHERE installation_id=$1 AND name LIKE 'bounded-%'", [
        installationId,
      ]);
    }
  });

  it("rejects an identity-conflicting reinstallation before it can cancel pending erasure", async () => {
    const lifecycle = store();
    await lifecycle.upsertInstallation(
      {
        type: "installation.upsert",
        installation: {
          ...installation,
          accountUserId: accountUserId + 999,
          accountLogin: "recycled-user-name",
        },
      },
      {
        deliveryId: `conflicting-reinstall-${randomUUID()}`,
        eventType: "installation",
        eventAction: "created",
      },
    );
    const identity = rows(
      await executor().query(
        "SELECT account_user_id,account_login,suspended_at FROM installations WHERE github_installation_id=$1",
        [externalInstallationId],
      ),
    )[0];
    expect(identity).toMatchObject({
      account_user_id: String(accountUserId),
      account_login: login,
      suspended_at: expect.any(Date),
    });
    const erasure = rows(
      await executor().query(
        "SELECT status FROM erasure_requests WHERE tenant_id=$1 AND requested_by='github_app_uninstall'",
        [login],
      ),
    );
    expect(erasure).toHaveLength(1);
    expect(erasure[0]?.status).toBe("pending");
  });

  it("never gives a recycled login access to legacy unbound requests without immutable proof", async () => {
    const legacy = randomUUID();
    legacyIds.push(legacy);
    await executor().query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,download_url)
       VALUES ($1,$2,'github_app_uninstall','completed','user',$2,'https://invalid.example/legacy')`,
      [legacy, login],
    );
    const recover = new DataLifecycleStore(executor());
    expect(
      await recover.getVerifiedHistoricalUserExport({
        exportId: legacy,
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
    const historical = rows(
      await executor().query("SELECT download_url,original_github_user_id FROM data_exports WHERE id=$1", [legacy]),
    );
    expect(historical[0]).toEqual({
      download_url: "https://invalid.example/legacy",
      original_github_user_id: null,
    });
  });

  it("fails historical inventory closed on a login-only unbound export even when the numeric GitHub user matches", async () => {
    const result = rows(
      await executor().query(
        "SELECT id FROM data_exports WHERE tenant_id=$1 AND original_github_user_id IS NULL LIMIT 1",
        [login],
      ),
    )[0];
    expect(result?.id).toBeDefined();
    expect(
      await prepareVerifiedHistoricalUserRepositoryInventory(executor(), {
        exportId: String(result?.id),
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
  });

  it("does not describe already-erased data as recoverable", async () => {
    const bound = rows(
      await executor().query(
        `SELECT id FROM data_exports WHERE tenant_id=$1
          AND original_github_user_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [login, accountUserId],
      ),
    )[0];
    if (typeof bound?.id !== "string") throw new Error("Missing bound historical request");
    await executor().query(
      "UPDATE erasure_requests SET status='completed',completed_at=NOW() WHERE tenant_id=$1 AND requested_by='github_app_uninstall'",
      [login],
    );
    expect(
      await new DataLifecycleStore(executor()).getVerifiedHistoricalUserExport({
        exportId: bound.id,
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
    expect(
      await prepareVerifiedHistoricalUserRepositoryInventory(executor(), {
        exportId: bound.id,
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
    expect(
      await prepareVerifiedHistoricalUserRunFindingSnapshot(executor(), {
        exportId: bound.id,
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
    expect(
      await prepareVerifiedHistoricalUserConsistentCorePreflight(executor(), {
        exportId: bound.id,
        verifiedGitHubUserId: accountUserId,
      }),
    ).toBeNull();
  });
});
