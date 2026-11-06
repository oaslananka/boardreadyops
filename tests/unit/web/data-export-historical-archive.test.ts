import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  HistoricalUserArchivePreflightError,
  prepareHistoricalUserMetadataOnlyArchive,
  prepareHistoricalUserPartialArchive,
  type VerifiedHistoricalArchiveObject,
  verifyHistoricalUserMetadataOnlyArchive,
  verifyHistoricalUserPartialArchive,
} from "../../../apps/web/lib/data-export-historical-archive.js";
import { assessHistoricalUserPrivateArchiveDisclosure } from "../../../apps/web/lib/data-export-historical-disclosure-readiness.js";
import { assessHistoricalUserMetadataExposure } from "../../../apps/web/lib/data-export-historical-metadata-exposure.js";
import { sanitizeAndExtractArchive } from "../../../packages/cloud-core/src/archive-sanitizer.js";
import { createZipBuffer } from "../../../src/util/zip.js";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const repoId = randomUUID();
const reviewId = randomUUID();
const runId = randomUUID();
const artifactId = randomUUID();
const visualIds = [randomUUID(), randomUUID()].sort();
const exportId = randomUUID();
const contents = Buffer.from("private-original-user-file", "utf8");

function inputs(options: { expired?: boolean; objects?: VerifiedHistoricalArchiveObject[] } = {}) {
  const snapshot = {
    kind: "boardreadyops.historical-user-consistent-core-preflight",
    formatVersion: 1,
    coverage: "retained-suspended-user-installation-core-and-scoped-audit-descriptors-only",
    completeCustomerExport: false,
    exportId,
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
    excludedSourceClassCounts: {
      runSnapshots: 2,
      apiTokens: 1,
      runnerRegistrations: 1,
      installationComponentCredentials: 1,
      installationComponentObservations: 1,
    },
    redactedAuditFieldCounts: {
      installationActorIdentities: 0,
      installationSubjectIdentifiers: 0,
      installationRequestIdentifiers: 0,
      installationPrivateMetadata: 0,
      repositoryActorIdentities: 0,
      repositorySubjectIdentifiers: 0,
      repositoryRequestIdentifiers: 0,
      repositoryPrivateMetadata: 0,
    },
    repositories: [
      {
        repositoryId: repoId,
        githubRepositoryId: "123456",
        owner: "",
        name: "",
        private: true,
        disabled: true,
      },
    ],
    runs: [
      {
        id: runId,
        repositoryId: repoId,
        commitSha: "a".repeat(40),
        ref: "",
        status: "completed",
        decision: "pass",
      },
    ],
    findings: [
      {
        id: randomUUID(),
        runId,
        ruleId: "private-rule",
        severity: "warning",
        message: "",
        path: null,
        kind: null,
      },
    ],
    reviews: [
      {
        id: reviewId,
        repositoryId: repoId,
        headRunId: runId,
        title: "",
        status: "open",
        decision: null,
      },
    ],
    revisions: [],
    findingDecisions: [
      {
        id: `fdec_${randomUUID()}`,
        repositoryId: repoId,
        reviewId,
        findingFingerprint: "finding-fingerprint",
        disposition: "mitigated",
        reason: "",
        evidenceDigest: "c".repeat(64),
        expiresAt: null,
        ownerIncluded: false,
        actorIncluded: false,
      },
    ],
    findingAssignments: [
      {
        id: `fasn_${randomUUID()}`,
        repositoryId: repoId,
        reviewId,
        findingFingerprint: "finding-fingerprint",
        assigneeIncluded: false,
        assignedByIncluded: false,
      },
    ],
    artifacts: [
      {
        id: artifactId,
        runId,
        kind: "report",
        name: "",
        role: "evidence",
        contentType: "application/octet-stream",
        sha256: sha256(contents),
        byteLength: contents.length,
        retentionExpired: options.expired === true,
        contentsVerified: false,
        downloadAvailable: false,
      },
    ],
    reviewComments: [
      {
        id: randomUUID(),
        reviewId,
        repositoryId: repoId,
        parentId: null,
        status: "active",
        authorType: "user",
        findingFingerprint: null,
        evidenceAnchor: null,
        content: "",
        contentIncluded: false,
        authorIdIncluded: false,
      },
    ],
    reviewApprovals: [
      {
        id: randomUUID(),
        repositoryId: repoId,
        reviewId,
        revisionId: null,
        status: "approved",
        evidenceDigest: "c".repeat(64),
        reason: null,
        invalidationReason: null,
        isBreakGlass: false,
        actorIncluded: false,
      },
    ],
    reviewChecklist: [
      {
        id: randomUUID(),
        repositoryId: repoId,
        reviewId,
        completed: false,
        title: "",
        titleIncluded: false,
        completedByIncluded: false,
      },
    ],
    installationAuditEvents: [],
    auditEvents: [],
  };
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const visualBody = Buffer.from(
    JSON.stringify({
      kind: "boardreadyops.historical-user-private-visual-evidence-preflight",
      formatVersion: 1,
      exportId,
      completeCustomerExport: false,
      contentIncluded: false,
      exclusions: [
        "visual-svg-content",
        "visual-anchors-and-rendering-metadata",
        "non-svg-visual-formats-unverified",
        "actor-and-audit-identities",
      ],
      visuals: visualIds.map((id, i) => ({
        id,
        runId,
        repositoryId: repoId,
        kind: i === 0 ? "pcb_layer" : "schematic",
        format: "svg",
        sha256: (i === 0 ? "a" : "b").repeat(64),
        byteLength: 24 + i,
      })),
    }),
  );
  return {
    snapshot: { bytes, sha256: sha256(bytes), byteLength: bytes.length },
    mutationEpochSha256: "c".repeat(64),
    visualEvidence: {
      bytes: visualBody,
      sha256: sha256(visualBody),
      byteLength: visualBody.length,
      visualCount: 2,
    },
    verifiedObjects: options.objects ?? [
      {
        artifactId,
        exportId,
        runId,
        repositoryId: repoId,
        sha256: sha256(contents),
        bytes: contents,
      },
    ],
  };
}

describe("private historical original-USER partial archive", () => {
  it("builds deterministic bounded ZIP of one historical snapshot and exact verified bytes", () => {
    const input = inputs();
    const first = prepareHistoricalUserPartialArchive(input);
    const second = prepareHistoricalUserPartialArchive(input);
    expect(first.files).toBe(4);
    expect(first.byteLength).toBe(first.bytes.length);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(sha256(first.bytes));
    expect(verifyHistoricalUserPartialArchive(first.bytes, first.sha256, exportId)).toBe(true);
    expect(verifyHistoricalUserPartialArchive(first.bytes, first.sha256, randomUUID())).toBe(false);
    expect(verifyHistoricalUserPartialArchive(first.bytes, "0".repeat(64), exportId)).toBe(false);
    const files = sanitizeAndExtractArchive(first.bytes).files;
    const byName = new Map(files.map((file) => [file.path, file.data]));
    expect(byName.get(`objects/${artifactId}.bin`)?.equals(contents)).toBe(true);
    const evidence = JSON.parse(
      byName.get("metadata/historical-private-visual-evidence.json")?.toString("utf8") ?? "{}",
    );
    expect(evidence.visuals).toHaveLength(2);
    expect(evidence.contentIncluded).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain("<svg");
    const snapshotCore = JSON.parse(byName.get("metadata/historical-core.json")?.toString("utf8") ?? "{}");
    expect(snapshotCore.findings[0].message).toBe("");
    expect(snapshotCore.reviewApprovals[0].invalidationReason).toBeNull();
    expect(snapshotCore.exclusions).toContain("unverified-collaboration-and-finding-free-text");
    expect(snapshotCore.exclusions).toContain("unverified-repository-review-and-artifact-identifying-metadata");
    expect(snapshotCore.repositories[0]).toMatchObject({ owner: "", name: "" });
    expect(snapshotCore.runs[0].ref).toBe("");
    expect(snapshotCore.findings[0].path).toBeNull();
    expect(snapshotCore.artifacts[0].name).toBe("");
    expect(snapshotCore.reviews[0].title).toBe("");
    expect(snapshotCore.reviewComments[0].evidenceAnchor).toBeNull();
    for (const rawText of [
      "private-original-finding-reason",
      "private-original-review-comment",
      "private-original-approval-reason",
      "private-original-checklist-title",
    ])
      expect(JSON.stringify(snapshotCore)).not.toContain(rawText);
    expect(snapshotCore.findingDecisions[0]).toMatchObject({
      repositoryId: repoId,
      reviewId,
      reason: "",
      ownerIncluded: false,
      actorIncluded: false,
    });
    expect(snapshotCore.findingAssignments[0]).toMatchObject({
      repositoryId: repoId,
      reviewId,
      assigneeIncluded: false,
      assignedByIncluded: false,
    });
    expect(snapshotCore.reviewComments[0]).toMatchObject({
      content: "",
      contentIncluded: false,
      authorIdIncluded: false,
    });
    expect(snapshotCore.reviewApprovals[0]).toMatchObject({
      reason: null,
      actorIncluded: false,
    });
    expect(snapshotCore.reviewChecklist[0]).toMatchObject({
      title: "",
      titleIncluded: false,
      completedByIncluded: false,
    });
    expect(JSON.stringify(snapshotCore)).not.toContain("reviewer-identity");
    const receipt = JSON.parse(byName.get("metadata/historical-integrity.json")?.toString("utf8") ?? "{}");
    expect(receipt).toMatchObject({
      exportId,
      scope: "partial-preflight-not-customer-export",
      completeCustomerExport: false,
      verifiedPhysicalArtifactCount: 1,
      verifiedPrivateVisualDigestCount: 2,
      privateVisualContentsIncluded: false,
      formatVersion: 3,
      originalUserMutationEpochSha256: "c".repeat(64),
      archiveExclusions: expect.arrayContaining(["review-actor-identities-and-audit-metadata", "platform-storage"]),
      metadataSnapshotExclusions: expect.arrayContaining([
        "managed-artifact-bytes",
        "finding-decision-owner-and-actor-identities",
        "finding-assignment-assignee-and-assigner-identities",
      ]),
    });
    expect(receipt.entries).toHaveLength(3);
    expect(receipt.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `objects/${artifactId}.bin`,
          sha256: sha256(contents),
          byteLength: contents.length,
        }),
      ]),
    );
  });

  it("builds a deterministic, three-file internal metadata-only ZIP without artifact bytes", () => {
    const fixture = inputs();
    const evidence = {
      snapshot: fixture.snapshot,
      visualEvidence: fixture.visualEvidence,
      mutationEpochSha256: fixture.mutationEpochSha256,
    };
    const first = prepareHistoricalUserMetadataOnlyArchive(evidence);
    const second = prepareHistoricalUserMetadataOnlyArchive(evidence);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(sha256(first.bytes));
    expect(first.files).toBe(3);
    expect(first.byteLength).toBe(first.bytes.length);
    const entries = sanitizeAndExtractArchive(first.bytes).files;
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      "metadata/historical-core.json",
      "metadata/historical-metadata-only-integrity.json",
      "metadata/historical-private-visual-evidence.json",
    ]);
    const receiptFile = entries.find((entry) => entry.path === "metadata/historical-metadata-only-integrity.json");
    const receipt = JSON.parse(receiptFile?.data.toString("utf8") ?? "{}");
    expect(receipt).toMatchObject({
      kind: "boardreadyops.historical-user-metadata-only-integrity-receipt",
      formatVersion: 1,
      scope: "private-metadata-only-not-customer-export",
      completeCustomerExport: false,
      customerDeliveryReady: false,
      physicalArtifactContentsIncluded: false,
      artifactDescriptorCount: 1,
      privateVisualContentsIncluded: false,
      privateVisualDescriptorCount: 2,
      originalUserMutationEpochSha256: "c".repeat(64),
      exclusions: expect.arrayContaining([
        "all-physical-artifact-file-bytes",
        "all-private-visual-svg-file-bytes",
        "customer-download-and-disclosure-authorization",
      ]),
    });
    expect(receipt.entries).toHaveLength(2);
    expect(first.bytes.includes(contents)).toBe(false);
    expect(verifyHistoricalUserMetadataOnlyArchive(first.bytes, first.sha256, exportId)).toBe(true);
    expect(verifyHistoricalUserPartialArchive(first.bytes, first.sha256, exportId)).toBe(false);
    const v3 = prepareHistoricalUserPartialArchive(fixture);
    expect(verifyHistoricalUserMetadataOnlyArchive(v3.bytes, v3.sha256, exportId)).toBe(false);
    expect(verifyHistoricalUserPartialArchive(v3.bytes, v3.sha256, exportId)).toBe(true);
    expect(verifyHistoricalUserMetadataOnlyArchive(first.bytes, first.sha256, randomUUID())).toBe(false);
    expect(verifyHistoricalUserMetadataOnlyArchive(first.bytes, "0".repeat(64), exportId)).toBe(false);
  });

  it("rejects fully rehashed object-byte injection and metadata receipt/identity forgery", () => {
    const fixture = inputs();
    const valid = prepareHistoricalUserMetadataOnlyArchive({
      snapshot: fixture.snapshot,
      visualEvidence: fixture.visualEvidence,
      mutationEpochSha256: fixture.mutationEpochSha256,
    });
    const originals = sanitizeAndExtractArchive(valid.bytes).files.map((item) => ({
      name: item.path,
      data: Buffer.from(item.data),
    }));
    const forgedWithObject = createZipBuffer([
      ...originals,
      { name: `objects/${artifactId}.bin`, data: Buffer.from(contents) },
    ]);
    expect(verifyHistoricalUserMetadataOnlyArchive(forgedWithObject, sha256(forgedWithObject), exportId)).toBe(false);

    for (const alter of [
      (receipt: Record<string, unknown>) => {
        receipt.physicalArtifactContentsIncluded = true;
      },
      (receipt: Record<string, unknown>) => {
        receipt.completeCustomerExport = true;
      },
      (receipt: Record<string, unknown>) => {
        receipt.customerDeliveryReady = true;
      },
      (receipt: Record<string, unknown>) => {
        receipt.artifactDescriptorCount = 0;
      },
      (receipt: Record<string, unknown>) => {
        receipt.originalUserMutationEpochSha256 = "not-a-digest";
      },
      (receipt: Record<string, unknown>) => {
        receipt.exportId = randomUUID();
      },
      (receipt: Record<string, unknown>) => {
        receipt.customerDownloadToken = "PRIVATE_DO_NOT_EXPORT";
      },
    ]) {
      const modified = originals.map((item) => ({ ...item }));
      const entry = modified.find((item) => item.name === "metadata/historical-metadata-only-integrity.json");
      if (!entry) throw new Error("Missing metadata-only receipt");
      const receipt = JSON.parse(entry.data.toString("utf8")) as Record<string, unknown>;
      alter(receipt);
      entry.data = Buffer.from(JSON.stringify(receipt));
      const forged = createZipBuffer(modified);
      expect(verifyHistoricalUserMetadataOnlyArchive(forged, sha256(forged), exportId)).toBe(false);
    }

    const modified = originals.map((item) => ({ ...item }));
    const coreFile = modified.find((item) => item.name === "metadata/historical-core.json");
    const receiptFile = modified.find((item) => item.name === "metadata/historical-metadata-only-integrity.json");
    if (!coreFile || !receiptFile) throw new Error("Missing core/receipt");
    const core = JSON.parse(coreFile.data.toString("utf8")) as {
      reviews: Array<{ title: string }>;
    };
    const review = core.reviews[0];
    if (!review) throw new Error("Missing review");
    review.title = "private-third-party-review-title";
    coreFile.data = Buffer.from(JSON.stringify(core));
    const receipt = JSON.parse(receiptFile.data.toString("utf8")) as {
      entries: Array<{ path: string; byteLength: number; sha256: string }>;
    };
    const integrity = receipt.entries.find((entry) => entry.path === coreFile.name);
    if (!integrity) throw new Error("Missing core digest");
    integrity.sha256 = sha256(coreFile.data);
    integrity.byteLength = coreFile.data.length;
    receiptFile.data = Buffer.from(JSON.stringify(receipt));
    const forged = createZipBuffer(modified);
    expect(verifyHistoricalUserMetadataOnlyArchive(forged, sha256(forged), exportId)).toBe(false);
    expect(verifyHistoricalUserMetadataOnlyArchive(valid.bytes, valid.sha256, exportId)).toBe(true);
  });

  it("returns only fixed risk-class counts from metadata ZIP and never source IDs or hashes", () => {
    const fixture = inputs();
    const metadataZip = prepareHistoricalUserMetadataOnlyArchive({
      snapshot: fixture.snapshot,
      visualEvidence: fixture.visualEvidence,
      mutationEpochSha256: fixture.mutationEpochSha256,
    });
    const result = assessHistoricalUserMetadataExposure({
      archiveBytes: metadataZip.bytes,
      exportId,
    });
    expect(result).toMatchObject({
      privateDiagnosticOnly: true,
      completeCustomerExport: false,
      customerDeliveryReady: false,
      releaseDecision: "NO_GO",
      physicalArtifactBytesIncluded: false,
      blockers: expect.arrayContaining([
        "original_user_provenance_not_attested_by_zip",
        "opaque_id_and_hash_disclosure_rights_unverified",
        "no_revocable_authenticated_delivery",
      ]),
    });
    expect(result?.exposure).toHaveLength(16);
    expect(result?.exposure).toEqual(
      expect.arrayContaining([
        { category: "github_repository_id", rows: 1, rightsVerified: false },
        { category: "commit_hash", rows: 1, rightsVerified: false },
        { category: "artifact_content_hash", rows: 1, rightsVerified: false },
        { category: "artifact_size", rows: 1, rightsVerified: false },
        { category: "comment_fingerprint", rows: 0, rightsVerified: false },
        { category: "decision_fingerprint", rows: 1, rightsVerified: false },
        { category: "visual_digest", rows: 2, rightsVerified: false },
      ]),
    );
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      exportId,
      repoId,
      runId,
      reviewId,
      artifactId,
      "123456",
      "private-rule",
      "finding-fingerprint",
      sha256(contents),
      "a".repeat(40),
      "c".repeat(64),
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    const physicalZip = prepareHistoricalUserPartialArchive(fixture);
    expect(
      assessHistoricalUserMetadataExposure({
        archiveBytes: physicalZip.bytes,
        exportId,
      }),
    ).toBeNull();
    expect(
      assessHistoricalUserMetadataExposure({
        archiveBytes: metadataZip.bytes,
        exportId: randomUUID(),
      }),
    ).toBeNull();
    const tampered = Buffer.from(metadataZip.bytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    expect(
      assessHistoricalUserMetadataExposure({
        archiveBytes: tampered,
        exportId,
      }),
    ).toBeNull();
    expect(
      assessHistoricalUserMetadataExposure({
        archiveBytes: Buffer.from("invalid ZIP"),
        exportId,
      }),
    ).toBeNull();
  });

  it("keeps every source-text disclosure and customer acceptance criterion explicitly unverified", () => {
    const zip = prepareHistoricalUserPartialArchive(inputs());
    const report = assessHistoricalUserPrivateArchiveDisclosure({ archiveBytes: zip.bytes, exportId });
    expect(report?.formatVersion).toBe(2);
    expect(report?.releaseDecision).toBe("NO_GO");
    expect(report?.textRightsAcceptance).toHaveLength(6);
    expect(report?.deliveryAcceptance).toHaveLength(8);
    for (const check of report?.textRightsAcceptance ?? []) {
      expect(check.authorProvenanceVerified).toBe(false);
      expect(check.thirdPartyDisclosureRightsVerified).toBe(false);
      expect(check.customerDisclosureAllowed).toBe(false);
      expect(check.requiredEvidence).toEqual([
        "source_author_provenance",
        "lawful_disclosure_basis",
        "sensitive_content_review",
      ]);
    }
    for (const check of report?.deliveryAcceptance ?? []) {
      expect(check.evidenceStatus).toBe("not_verified");
      expect(check.customerDeliveryAllowed).toBe(false);
      expect(report?.blockers).toContain(check.blockerCode);
    }
    expect(report?.deliveryAcceptance.map((v) => v.requiredEvidence)).toContain(
      "stream_revocation_hold_erasure_and_disconnect_e2e",
    );
    expect(JSON.stringify(report)).not.toContain("private-original-review-comment");
  });

  it("reports privacy blockers and bounded class counts without leaking text, IDs or filenames", () => {
    const zip = prepareHistoricalUserPartialArchive(inputs());
    const report = assessHistoricalUserPrivateArchiveDisclosure({ archiveBytes: zip.bytes, exportId });
    expect(report).toMatchObject({
      privateDiagnosticOnly: true,
      completeCustomerExport: false,
      customerDeliveryReady: false,
      verifiedArchiveSha256: zip.sha256,
      sourceRowCounts: {
        repositories: 1,
        runs: 1,
        artifacts: 1,
        reviews: 1,
        reviewComments: 1,
        reviewApprovals: 1,
        reviewChecklist: 1,
        findingDecisions: 1,
        findingAssignments: 1,
      },
      privateTextReviewCounts: {
        "findings.message": 0,
        "reviewComments.content": 0,
        "reviewApprovals.reason": 0,
        "reviewApprovals.invalidationReason": 0,
        "reviewChecklist.title": 0,
        "findingDecisions.reason": 0,
      },
      excludedSensitiveSourceCounts: { runSnapshots: 2, apiTokens: 1 },
    });
    expect(report?.blockers).toEqual(
      expect.arrayContaining([
        "partial_source_coverage",
        "third_party_content_disclosure_rights_unverified",
        "retained_sensitive_source_records_excluded",
        "source_text_disclosure_disabled_by_policy",
        "no_authenticated_customer_delivery_entitlement",
        "no_in_flight_revocation_hold_erasure_acceptance",
      ]),
    );
    const publicShape = JSON.stringify(report);
    for (const privateValue of [
      repoId,
      runId,
      reviewId,
      artifactId,
      exportId,
      "private-owner",
      "private-original-review-comment",
      "private-original-approval-reason",
      "private-original-finding-reason",
      "original-private.bin",
      "private-original-user-file",
    ]) {
      expect(publicShape).not.toContain(privateValue);
    }
    expect(
      assessHistoricalUserPrivateArchiveDisclosure({
        archiveBytes: zip.bytes,
        exportId: randomUUID(),
      }),
    ).toBeNull();
    expect(
      assessHistoricalUserPrivateArchiveDisclosure({
        archiveBytes: Buffer.from("not a zip"),
        exportId,
      }),
    ).toBeNull();
  });

  it("keeps all delivery blockers when historical core and exclusion counts are empty", () => {
    const input = inputs({ objects: [] });
    const core = JSON.parse(input.snapshot.bytes.toString("utf8")) as Record<string, unknown>;
    for (const key of [
      "repositories",
      "runs",
      "findings",
      "artifacts",
      "reviews",
      "revisions",
      "reviewComments",
      "reviewApprovals",
      "reviewChecklist",
      "findingDecisions",
      "findingAssignments",
      "installationAuditEvents",
      "auditEvents",
    ]) {
      core[key] = [];
    }
    for (const key of Object.keys(core.excludedSourceClassCounts as Record<string, number>)) {
      (core.excludedSourceClassCounts as Record<string, number>)[key] = 0;
    }
    const coreBytes = Buffer.from(JSON.stringify(core));
    const visual = JSON.parse(input.visualEvidence.bytes.toString("utf8")) as Record<string, unknown>;
    visual.visuals = [];
    const visualBytes = Buffer.from(JSON.stringify(visual));
    const zip = prepareHistoricalUserPartialArchive({
      ...input,
      snapshot: { bytes: coreBytes, sha256: sha256(coreBytes), byteLength: coreBytes.length },
      visualEvidence: {
        bytes: visualBytes,
        sha256: sha256(visualBytes),
        byteLength: visualBytes.length,
        visualCount: 0,
      },
      verifiedObjects: [],
    });
    const report = assessHistoricalUserPrivateArchiveDisclosure({ archiveBytes: zip.bytes, exportId });
    expect(report?.customerDeliveryReady).toBe(false);
    expect(report?.completeCustomerExport).toBe(false);
    expect(report?.releaseDecision).toBe("NO_GO");
    expect(report?.textRightsAcceptance).toHaveLength(6);
    expect(
      report?.textRightsAcceptance.every(
        (r) =>
          r.nonEmptyRows === 0 &&
          r.customerDisclosureAllowed === false &&
          r.thirdPartyDisclosureRightsVerified === false,
      ),
    ).toBe(true);
    expect(report?.deliveryAcceptance).toHaveLength(8);
    expect(
      report?.deliveryAcceptance.every(
        (r) => r.evidenceStatus === "not_verified" && r.customerDeliveryAllowed === false,
      ),
    ).toBe(true);
    expect(Object.values(report?.sourceRowCounts ?? {}).every((n) => n === 0)).toBe(true);
    expect(Object.values(report?.excludedSensitiveSourceCounts ?? {}).every((n) => n === 0)).toBe(true);
    expect(report?.blockers).toContain("partial_source_coverage");
    expect(report?.blockers).toContain("third_party_content_disclosure_rights_unverified");
    expect(report?.blockers).not.toContain("retained_unstructured_text_requires_manual_rights_review");
  });

  it("never returns retained third-party text, even in a fully rehashed structurally valid ZIP", () => {
    const zip = prepareHistoricalUserPartialArchive(inputs());
    const files = sanitizeAndExtractArchive(zip.bytes).files.map((f) => ({
      name: f.path,
      data: Buffer.from(f.data),
    }));
    const metadata = files.find((f) => f.name === "metadata/historical-core.json");
    const receiptFile = files.find((f) => f.name === "metadata/historical-integrity.json");
    if (!metadata || !receiptFile) throw new Error("Fixture missing required metadata");
    const core = JSON.parse(metadata.data.toString("utf8")) as { reviewComments: Array<{ content: string }> };
    const comment = core.reviewComments[0];
    if (!comment) throw new Error("Fixture missing comment");
    comment.content = "UNSAFE_PRIVATE_THIRD_PARTY_TEXT_HERE";
    metadata.data = Buffer.from(JSON.stringify(core));
    const receipt = JSON.parse(receiptFile.data.toString("utf8")) as {
      entries: Array<{ path: string; sha256: string; byteLength: number }>;
    };
    const metadataReceipt = receipt.entries.find((entry) => entry.path === metadata.name);
    if (!metadataReceipt) throw new Error("Missing metadata receipt");
    metadataReceipt.sha256 = sha256(metadata.data);
    metadataReceipt.byteLength = metadata.data.length;
    receiptFile.data = Buffer.from(JSON.stringify(receipt));
    const rebuilt = createZipBuffer(files);
    const rebuiltSha = sha256(rebuilt);
    expect(verifyHistoricalUserPartialArchive(rebuilt, rebuiltSha, exportId)).toBe(false);
    const report = assessHistoricalUserPrivateArchiveDisclosure({ archiveBytes: rebuilt, exportId });
    expect(report).toBeNull();
  });

  it("rejects foreign, non-SVG, identity-bearing or mismatched private visual metadata", () => {
    const mutations: Array<(visual: Record<string, unknown>, body: Record<string, unknown>) => void> = [
      (visual) => {
        visual.repositoryId = randomUUID();
      },
      (visual) => {
        visual.runId = randomUUID();
      },
      (visual) => {
        visual.format = "png";
      },
      (visual) => {
        visual.byteLength = 262145;
      },
      (visual) => {
        visual.byteLength = -1;
      },
      (visual) => {
        visual.sha256 = "0";
      },
      (visual) => {
        visual.snapshotId = "private-fab-sheet-name";
      },
      (visual) => {
        visual.svg = "<svg><script>private</script></svg>";
      },
      (_visual, body) => {
        body.contentIncluded = true;
      },
      (_visual, body) => {
        body.exportId = randomUUID();
      },
      (_visual, body) => {
        (body.visuals as unknown[]).pop();
      },
    ];
    for (const mutate of mutations) {
      const input = inputs();
      const body = JSON.parse(input.visualEvidence.bytes.toString("utf8")) as Record<string, unknown>;
      mutate((body.visuals as Record<string, unknown>[])[0] ?? {}, body);
      const bytes = Buffer.from(JSON.stringify(body));
      expect(() =>
        prepareHistoricalUserPartialArchive({
          ...input,
          visualEvidence: {
            bytes,
            sha256: sha256(bytes),
            byteLength: bytes.length,
            visualCount: input.visualEvidence.visualCount,
          },
        }),
      ).toThrow(HistoricalUserArchivePreflightError);
    }
  });

  it("rejects missing visual evidence and forged ZIP visual ownership despite recomputed hashes", () => {
    const valid = inputs();
    expect(() =>
      prepareHistoricalUserPartialArchive({
        ...valid,
        visualEvidence: undefined as never,
      }),
    ).toThrow(HistoricalUserArchivePreflightError);
    const archive = prepareHistoricalUserPartialArchive(valid);
    const originals = sanitizeAndExtractArchive(archive.bytes).files;
    const swapped = originals.map((file) => {
      if (file.path !== "metadata/historical-private-visual-evidence.json") {
        return { name: file.path, data: file.data };
      }
      const changed = JSON.parse(file.data.toString("utf8")) as {
        visuals: Array<{ repositoryId: string }>;
      };
      const first = changed.visuals[0];
      if (!first) throw new Error("Fixture must include visual");
      first.repositoryId = randomUUID();
      return { name: file.path, data: Buffer.from(JSON.stringify(changed)) };
    });
    const rebuilt = swapped.map((file) => {
      if (file.name !== "metadata/historical-integrity.json") return file;
      const receipt = JSON.parse(file.data.toString("utf8")) as {
        entries: Array<{ path: string; byteLength: number; sha256: string }>;
      };
      const entry = receipt.entries.find((value) => value.path === "metadata/historical-private-visual-evidence.json");
      const newVisual = swapped.find((value) => value.name === "metadata/historical-private-visual-evidence.json");
      if (!entry || !newVisual) throw new Error("Missing visual receipt");
      entry.byteLength = newVisual.data.length;
      entry.sha256 = sha256(newVisual.data);
      return { name: file.name, data: Buffer.from(JSON.stringify(receipt)) };
    });
    const forged = createZipBuffer(rebuilt);
    expect(verifyHistoricalUserPartialArchive(forged, sha256(forged), exportId)).toBe(false);
    const omitted = createZipBuffer(
      rebuilt.filter((entry) => entry.name !== "metadata/historical-private-visual-evidence.json"),
    );
    expect(verifyHistoricalUserPartialArchive(omitted, sha256(omitted), exportId)).toBe(false);
  });

  it("fails closed when any declared physical artifact is missing or copied from another owner", () => {
    expect(() => prepareHistoricalUserPartialArchive({ ...inputs(), verifiedObjects: [] })).toThrow(
      HistoricalUserArchivePreflightError,
    );
    expect(() =>
      prepareHistoricalUserPartialArchive({
        ...inputs(),
        verifiedObjects: [inputs().verifiedObjects[0], inputs().verifiedObjects[0]].filter(
          (item): item is VerifiedHistoricalArchiveObject => Boolean(item),
        ),
      }),
    ).toThrow(HistoricalUserArchivePreflightError);
    for (const different of [
      { exportId: randomUUID() },
      { artifactId: randomUUID() },
      { repositoryId: randomUUID() },
      { runId: randomUUID() },
      { bytes: Buffer.from("tampered-original-user-file") },
      { sha256: "a".repeat(64) },
    ]) {
      const original = inputs();
      expect(() =>
        prepareHistoricalUserPartialArchive({
          ...original,
          snapshot: original.snapshot,
          verifiedObjects: original.verifiedObjects.map((object) => ({ ...object, ...different })),
        }),
      ).toThrow(HistoricalUserArchivePreflightError);
    }
  });

  it("fails closed on unknown sensitive fields and changed privacy flags in every core class", () => {
    const first = (core: Record<string, unknown>, key: string) => (core[key] as Array<Record<string, unknown>>)[0];
    const attacks: Array<(core: Record<string, unknown>) => void> = [
      (core) => {
        core.rawOauthAccessToken = "must-never-enter-customer-zip";
      },
      (core) => {
        first(core, "repositories").ownerPrivateEmail = "private@example.test";
      },
      (core) => {
        first(core, "runs").githubAuthToken = "secret-test-run";
      },
      (core) => {
        first(core, "artifacts").downloadAvailable = true;
      },
      (core) => {
        first(core, "artifacts").contentsVerified = true;
      },
      (core) => {
        first(core, "artifacts").unverifiedPrivateUri = "private://artifact";
      },
      (core) => {
        first(core, "reviews").actorId = "third-party-person";
      },
      (core) => {
        first(core, "findings").message = "unverified-third-party-finding-detail";
      },
      (core) => {
        first(core, "reviewComments").content = "unverified-third-party-review-comment";
      },
      (core) => {
        first(core, "reviewComments").contentIncluded = true;
      },
      (core) => {
        first(core, "reviewApprovals").reason = "unverified-approval-reason";
      },
      (core) => {
        first(core, "reviewApprovals").invalidationReason = "unverified-revocation-reason";
      },
      (core) => {
        first(core, "reviewChecklist").title = "unverified-third-party-title";
      },
      (core) => {
        first(core, "reviewChecklist").titleIncluded = true;
      },
      (core) => {
        first(core, "findingDecisions").reason = "unverified-finding-decision-reason";
      },
      (core) => {
        first(core, "repositories").owner = "private-repo-owner";
      },
      (core) => {
        first(core, "repositories").name = "private-repo-name";
      },
      (core) => {
        first(core, "runs").ref = "refs/heads/private-engineering";
      },
      (core) => {
        first(core, "findings").path = "secret/private-design.kicad_pcb";
      },
      (core) => {
        first(core, "artifacts").name = "private-netlist.txt";
      },
      (core) => {
        first(core, "reviews").title = "private-review-title";
      },
      (core) => {
        first(core, "reviewComments").evidenceAnchor = "private-annotation-anchor";
      },
      (core) => {
        first(core, "reviewComments").authorId = "third-party-reviewer";
      },
      (core) => {
        first(core, "reviewComments").authorIdIncluded = true;
      },
      (core) => {
        first(core, "reviewApprovals").approverId = "private-approver";
      },
      (core) => {
        first(core, "reviewApprovals").actorIncluded = true;
      },
      (core) => {
        first(core, "reviewChecklist").completedByIncluded = true;
      },
      (core) => {
        first(core, "findingDecisions").ownerIncluded = true;
      },
      (core) => {
        first(core, "findingAssignments").assignee = "private-assignee";
      },
      (core) => {
        (core.exclusions as string[]).push("raw-actor-data-allowed");
      },
      (core) => {
        (core.exclusions as string[]).splice(0, 1);
      },
      (core) => {
        delete core.reviewComments;
      },
    ];
    for (const attack of attacks) {
      const valid = inputs();
      const core = JSON.parse(valid.snapshot.bytes.toString("utf8")) as Record<string, unknown>;
      attack(core);
      const bytes = Buffer.from(JSON.stringify(core));
      expect(() =>
        prepareHistoricalUserPartialArchive({
          ...valid,
          snapshot: { bytes, sha256: sha256(bytes), byteLength: bytes.length },
        }),
      ).toThrow(HistoricalUserArchivePreflightError);
    }
  });

  it("rejects an identity-injected private core ZIP after recomputing every receipt and ZIP hash", () => {
    const valid = prepareHistoricalUserPartialArchive(inputs());
    const entries = sanitizeAndExtractArchive(valid.bytes).files.map((entry) => ({
      name: entry.path,
      data: Buffer.from(entry.data),
    }));
    const target = entries.find((entry) => entry.name === "metadata/historical-core.json");
    const receiptEntry = entries.find((entry) => entry.name === "metadata/historical-integrity.json");
    if (!target || !receiptEntry) throw new Error("Incomplete valid fixture");
    const core = JSON.parse(target.data.toString("utf8")) as {
      reviewComments: Array<Record<string, unknown>>;
    };
    const comment = core.reviewComments[0];
    if (!comment) throw new Error("Missing original comment");
    comment.authorId = "private-reviewer-identity";
    target.data = Buffer.from(JSON.stringify(core));
    const receipt = JSON.parse(receiptEntry.data.toString("utf8")) as {
      entries: Array<{ path: string; byteLength: number; sha256: string }>;
    };
    const affected = receipt.entries.find((entry) => entry.path === target.name);
    if (!affected) throw new Error("Missing metadata digest");
    affected.byteLength = target.data.length;
    affected.sha256 = sha256(target.data);
    receiptEntry.data = Buffer.from(JSON.stringify(receipt));
    const forged = createZipBuffer(entries);
    expect(verifyHistoricalUserPartialArchive(forged, sha256(forged), exportId)).toBe(false);
    expect(verifyHistoricalUserPartialArchive(valid.bytes, valid.sha256, exportId)).toBe(true);
  });

  it("rejects a modified partial metadata coverage count even with a recomputed digest", () => {
    for (const tamper of [
      { field: "apiTokens", value: 101 },
      { field: "runSnapshots", value: -1 },
      { field: "runnerRegistrations", value: 1.25 },
      { field: "unknown", value: 1 },
    ]) {
      const original = inputs();
      const core = JSON.parse(original.snapshot.bytes.toString("utf8")) as {
        excludedSourceClassCounts: Record<string, number>;
      };
      core.excludedSourceClassCounts[tamper.field] = tamper.value;
      const bytes = Buffer.from(JSON.stringify(core));
      expect(() =>
        prepareHistoricalUserPartialArchive({
          ...original,
          snapshot: { bytes, byteLength: bytes.length, sha256: sha256(bytes) },
        }),
      ).toThrow(HistoricalUserArchivePreflightError);
    }
  });

  it("quarantines forged audit-redaction counts and identity-bearing audit fields with recomputed SHA", () => {
    for (const mutate of [
      (body: Record<string, unknown>) => {
        const counts = body.redactedAuditFieldCounts as Record<string, number>;
        counts.repositoryActorIdentities = 1;
      },
      (body: Record<string, unknown>) => {
        const counts = body.redactedAuditFieldCounts as Record<string, number>;
        counts.installationPrivateMetadata = -1;
      },
      (body: Record<string, unknown>) => {
        const counts = body.redactedAuditFieldCounts as Record<string, number>;
        counts.other = 0;
      },
      (body: Record<string, unknown>) => {
        body.auditEvents = [
          {
            id: randomUUID(),
            repositoryId: repoId,
            releaseRunId: runId,
            eventType: "review.approved",
            actorType: "system",
            subjectType: "review",
            actorDetailsIncluded: false,
            subjectDetailsIncluded: false,
            requestIdIncluded: false,
            metadataIncluded: false,
            actorId: "a-person-identity",
          },
        ];
      },
      (body: Record<string, unknown>) => {
        body.installationAuditEvents = [
          {
            id: randomUUID(),
            eventType: "installation.suspended",
            actorType: "a_person_identifier",
            subjectType: "installation",
            actorDetailsIncluded: false,
            subjectDetailsIncluded: false,
            requestIdIncluded: false,
            metadataIncluded: false,
          },
        ];
      },
      (body: Record<string, unknown>) => {
        body.auditEvents = [
          {
            id: randomUUID(),
            repositoryId: randomUUID(),
            releaseRunId: runId,
            eventType: "review.approved",
            actorType: "system",
            subjectType: "review",
            actorDetailsIncluded: false,
            subjectDetailsIncluded: false,
            requestIdIncluded: false,
            metadataIncluded: false,
          },
        ];
      },
    ]) {
      const original = inputs();
      const core = JSON.parse(original.snapshot.bytes.toString("utf8")) as Record<string, unknown>;
      mutate(core);
      const bytes = Buffer.from(JSON.stringify(core));
      expect(() =>
        prepareHistoricalUserPartialArchive({
          ...original,
          snapshot: { bytes, sha256: sha256(bytes), byteLength: bytes.length },
        }),
      ).toThrow(HistoricalUserArchivePreflightError);
    }
  });

  it("rejects foreign finding review links and person IDs in an otherwise SHA-consistent snapshot", () => {
    const tampering = [
      { type: "decision", field: "repositoryId", value: randomUUID() },
      { type: "assignment", field: "reviewId", value: randomUUID() },
      { type: "decision", field: "owner", value: "private-identity" },
      { type: "assignment", field: "assignee", value: "private-identity" },
      { type: "decision", field: "reason", value: "🚀".repeat(1200) },
      { type: "assignment", field: "findingFingerprint", value: "🚀".repeat(550) },
    ] as const;
    for (const { type, field, value } of tampering) {
      const original = inputs();
      const modified = JSON.parse(original.snapshot.bytes.toString("utf8")) as {
        findingDecisions: Record<string, unknown>[];
        findingAssignments: Record<string, unknown>[];
      };
      const entry = (type === "decision" ? modified.findingDecisions : modified.findingAssignments)[0];
      if (!entry) throw new Error("Missing synthetic historical collaboration record");
      entry[field] = value;
      const bytes = Buffer.from(JSON.stringify(modified));
      expect(() =>
        prepareHistoricalUserPartialArchive({
          ...original,
          snapshot: { bytes, sha256: sha256(bytes), byteLength: bytes.length },
        }),
      ).toThrow(HistoricalUserArchivePreflightError);
    }
  });

  it("rejects expired object, altered snapshot digest, swapped relationship and false completion flag", () => {
    expect(() => prepareHistoricalUserPartialArchive(inputs({ expired: true }))).toThrow(
      HistoricalUserArchivePreflightError,
    );
    const original = inputs();
    expect(() =>
      prepareHistoricalUserPartialArchive({
        ...original,
        snapshot: { ...original.snapshot, sha256: "a".repeat(64) },
      }),
    ).toThrow(HistoricalUserArchivePreflightError);
    const wrong = JSON.parse(original.snapshot.bytes.toString("utf8"));
    wrong.runs[0].repositoryId = randomUUID();
    const bytes = Buffer.from(JSON.stringify(wrong));
    expect(() =>
      prepareHistoricalUserPartialArchive({
        ...original,
        snapshot: { bytes, sha256: sha256(bytes), byteLength: bytes.length },
      }),
    ).toThrow(HistoricalUserArchivePreflightError);
    wrong.runs[0].repositoryId = repoId;
    wrong.completeCustomerExport = true;
    const misleading = Buffer.from(JSON.stringify(wrong));
    expect(() =>
      prepareHistoricalUserPartialArchive({
        ...original,
        snapshot: { bytes: misleading, sha256: sha256(misleading), byteLength: misleading.length },
      }),
    ).toThrow(HistoricalUserArchivePreflightError);
  });

  it("rejects forged archive entries even with a recomputed trusted full ZIP hash", () => {
    const prepared = prepareHistoricalUserPartialArchive(inputs());
    const extracted = sanitizeAndExtractArchive(prepared.bytes).files;
    const altered = extracted.map((file) => ({
      name: file.path,
      data: file.path === `objects/${artifactId}.bin` ? Buffer.alloc(contents.length, 17) : file.data,
    }));
    const tampered = createZipBuffer(altered);
    expect(verifyHistoricalUserPartialArchive(tampered, sha256(tampered), exportId)).toBe(false);

    const withExtra = createZipBuffer([...altered, { name: "objects/extra.bin", data: Buffer.from("not owned") }]);
    expect(verifyHistoricalUserPartialArchive(withExtra, sha256(withExtra), exportId)).toBe(false);
  });

  it("rejects undeclared v3 receipt and entry fields even when the full ZIP hash is recomputed", () => {
    const prepared = prepareHistoricalUserPartialArchive(inputs());
    const original = sanitizeAndExtractArchive(prepared.bytes).files;
    for (const injection of ["receipt", "entry"] as const) {
      const rewritten = original.map((file) => {
        if (file.path !== "metadata/historical-integrity.json") return { name: file.path, data: file.data };
        const receipt = JSON.parse(file.data.toString("utf8")) as {
          entries: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
        if (injection === "receipt") {
          receipt.undeclaredPrivateMetadata = "not-an-allowed-receipt-field";
        } else {
          const entry = receipt.entries[0];
          if (!entry) throw new Error("Archive fixture must contain a receipt entry");
          entry.undeclaredPrivateMetadata = "not-an-allowed-entry-field";
        }
        return { name: file.path, data: Buffer.from(JSON.stringify(receipt)) };
      });
      const forged = createZipBuffer(rewritten);
      expect(verifyHistoricalUserPartialArchive(forged, sha256(forged), exportId)).toBe(false);
    }
    expect(verifyHistoricalUserPartialArchive(prepared.bytes, prepared.sha256, exportId)).toBe(true);
  });

  it("never accepts a fabricated complete export or ZIP with duplicate entries", () => {
    const prepared = prepareHistoricalUserPartialArchive(inputs());
    const original = sanitizeAndExtractArchive(prepared.bytes).files;
    const rewritten = original.map((file) => {
      if (file.path !== "metadata/historical-integrity.json") return { name: file.path, data: file.data };
      const receipt = JSON.parse(file.data.toString("utf8"));
      receipt.completeCustomerExport = true;
      return { name: file.path, data: Buffer.from(JSON.stringify(receipt)) };
    });
    const forged = createZipBuffer(rewritten);
    expect(verifyHistoricalUserPartialArchive(forged, sha256(forged), exportId)).toBe(false);
    const first = rewritten[0];
    if (!first) throw new Error("Fixture must include metadata");
    const duplicate = createZipBuffer([...rewritten, { name: first.name, data: first.data }]);
    expect(verifyHistoricalUserPartialArchive(duplicate, sha256(duplicate), exportId)).toBe(false);
  });
});
