import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ExportArchivePreflightError,
  prepareClaimedArchiveEntries,
} from "../../../apps/web/lib/data-export-archive-entries.js";

type Input = Parameters<typeof prepareClaimedArchiveEntries>[0];
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const slice = (data: unknown) => {
  const bytes = Buffer.from(
    JSON.stringify(
      data && typeof data === "object" && !Array.isArray(data)
        ? { formatVersion: 1, exportId: "export-1", ...data }
        : data,
    ),
  );
  return { bytes, byteLength: bytes.length, sha256: hash(bytes), contentType: "application/json" as const };
};

function fixture() {
  const bytes = Buffer.from("synthetic-only; never customer data");
  const object = {
    artifactId: "artifact_1",
    runId: "run_1",
    repositoryId: "repo_1",
    storagePath: "private/never-export-this-path",
    sha256: hash(bytes),
    byteLength: bytes.length,
  };
  const metadata = {
    id: object.artifactId,
    runId: object.runId,
    sha256: object.sha256,
    byteLength: object.byteLength,
  };
  const slices = {
    repositories: slice({
      coverage: "selected-installation-repositories-only",
      repositories: [{ repositoryId: "repo_1" }],
    }),
    records: slice({
      kind: "boardreadyops.claimed-run-finding-snapshot",
      runs: [{ id: "run_1", repositoryId: "repo_1" }],
      findings: [],
    }),
    reviewAudit: slice({
      kind: "boardreadyops.claimed-review-audit-snapshot",
      reviews: [],
      revisions: [],
      auditEvents: [],
    }),
    reviewComments: slice({ kind: "boardreadyops.claimed-review-comments-snapshot", comments: [] }),
    reviewWorkflow: slice({
      kind: "boardreadyops.claimed-review-workflow-snapshot",
      approvals: [],
      checklistItems: [],
    }),
    findingCollaboration: slice({
      kind: "boardreadyops.claimed-finding-collaboration-snapshot",
      decisions: [],
      assignments: [],
    }),
    artifactMetadata: slice({ kind: "boardreadyops.claimed-artifact-metadata-snapshot", artifacts: [metadata] }),
  } as Input["slices"];
  return { input: { slices, verifiedObjects: [{ object, bytes }] } as Input, bytes, object, metadata };
}

describe("claimed archive entry preflight (not a deliverable archive)", () => {
  it("prepares seven metadata entries and exact digest-matched object bytes", () => {
    const { input, bytes, object } = fixture();
    const result = prepareClaimedArchiveEntries(input);
    expect(result.entries).toHaveLength(8);
    expect(result.entries.map((entry) => entry.path)).toEqual([
      "metadata/repositories.json",
      "metadata/runs-findings.json",
      "metadata/reviews-audit.json",
      "metadata/review-comments.json",
      "metadata/review-workflow.json",
      "metadata/finding-collaboration.json",
      "metadata/artifacts.json",
      "objects/artifact_1.bin",
    ]);
    expect(result.entries[7].bytes).toEqual(bytes);
    expect(result.entries[7].sha256).toBe(object.sha256);
    expect(result.totalBytes).toBe(result.entries.reduce((sum, entry) => sum + entry.byteLength, 0));
    expect(result.entries.every((entry) => entry.sha256 === hash(entry.bytes))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(object.storagePath);
    const expected = Buffer.from(bytes);
    input.verifiedObjects[0].bytes.fill(0);
    expect(result.entries[7].bytes).toEqual(expected);
  });

  it("permits a legitimate metadata-only snapshot with no artifacts", () => {
    const { input } = fixture();
    input.slices.artifactMetadata = slice({
      ...JSON.parse(input.slices.artifactMetadata.bytes.toString("utf8")),
      artifacts: [],
    });
    input.verifiedObjects = [];
    const result = prepareClaimedArchiveEntries(input);
    expect(result.entries).toHaveLength(7);
    expect(result.entries.every((entry) => entry.path.startsWith("metadata/"))).toBe(true);
  });

  it("rejects a mixed-export metadata set even when every slice has a valid digest", () => {
    const { input } = fixture();
    for (const key of [
      "repositories",
      "records",
      "reviewAudit",
      "reviewComments",
      "reviewWorkflow",
      "findingCollaboration",
      "artifactMetadata",
    ] as const) {
      const changed = JSON.parse(input.slices[key].bytes.toString("utf8")) as Record<string, unknown>;
      const wrong = slice({ ...changed, exportId: "another-export" });
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          slices: { ...input.slices, [key]: wrong },
        }),
      ).toThrow(ExportArchivePreflightError);
    }
    const missing = slice({ ...JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")), exportId: null });
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, reviewAudit: missing },
      }),
    ).toThrow(ExportArchivePreflightError);
  });

  it("rejects a swapped or wrongly versioned metadata slice with a valid digest and exportId", () => {
    const { input } = fixture();
    const swapped = { ...input.slices, reviewComments: input.slices.reviewAudit };
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: swapped })).toThrow(ExportArchivePreflightError);
    const original = JSON.parse(input.slices.reviewWorkflow.bytes.toString("utf8")) as Record<string, unknown>;
    for (const header of [
      { ...original, kind: "boardreadyops.claimed-review-comments-snapshot" },
      { ...original, kind: null },
      { ...original, formatVersion: 2 },
      { ...original, formatVersion: null },
    ]) {
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          slices: { ...input.slices, reviewWorkflow: slice(header) },
        }),
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects missing, additional and duplicate physical objects", () => {
    const { input } = fixture();
    for (const verifiedObjects of [
      [],
      [...input.verifiedObjects, input.verifiedObjects[0]],
      [
        ...input.verifiedObjects,
        { ...input.verifiedObjects[0], object: { ...input.verifiedObjects[0].object, artifactId: "extra" } },
      ],
    ]) {
      expect(() => prepareClaimedArchiveEntries({ ...input, verifiedObjects })).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects duplicate artifact metadata that hides an unused verified object", () => {
    const { input, metadata } = fixture();
    const extra = {
      ...input.verifiedObjects[0],
      object: { ...input.verifiedObjects[0].object, artifactId: "artifact_2" },
    };
    const duplicateMetadata = slice({ artifacts: [metadata, metadata] });
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, artifactMetadata: duplicateMetadata },
        verifiedObjects: [...input.verifiedObjects, extra],
      }),
    ).toThrow(ExportArchivePreflightError);
  });

  it("fails closed when path, SHA-256, length, run or repository cannot be reconciled", () => {
    const { input } = fixture();
    const original = input.verifiedObjects[0];
    for (const change of [
      { object: { ...original.object, repositoryId: "foreign-repo" } },
      { object: { ...original.object, runId: "foreign-run" } },
      { object: { ...original.object, sha256: "f".repeat(64) } },
      { object: { ...original.object, byteLength: original.object.byteLength + 1 } },
      { bytes: Buffer.alloc(original.bytes.length) },
    ]) {
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          verifiedObjects: [{ ...original, ...change }],
        }),
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects a foreign run even when the archive has no artifact bytes", () => {
    const { input } = fixture();
    const metadataOnly = {
      ...input,
      verifiedObjects: [],
      slices: {
        ...input.slices,
        artifactMetadata: slice({
          kind: "boardreadyops.claimed-artifact-metadata-snapshot",
          artifacts: [],
        }),
        records: slice({
          kind: "boardreadyops.claimed-run-finding-snapshot",
          runs: [{ id: "run_1", repositoryId: "foreign-repo" }],
          findings: [],
        }),
      },
    };
    expect(() => prepareClaimedArchiveEntries(metadataOnly)).toThrow(ExportArchivePreflightError);
  });

  it("rejects findings referring to a missing release run without any artifacts", () => {
    const { input } = fixture();
    const metadataOnly = {
      ...input,
      verifiedObjects: [],
      slices: {
        ...input.slices,
        artifactMetadata: slice({
          kind: "boardreadyops.claimed-artifact-metadata-snapshot",
          artifacts: [],
        }),
        records: slice({
          kind: "boardreadyops.claimed-run-finding-snapshot",
          runs: [{ id: "run_1", repositoryId: "repo_1" }],
          findings: [{ id: "finding_1", runId: "run_unknown" }],
        }),
      },
    };
    expect(() => prepareClaimedArchiveEntries(metadataOnly)).toThrow(ExportArchivePreflightError);
  });

  it("accepts scoped review and collaboration records in the same repository", () => {
    const { input } = fixture();
    const originalAudit = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    const linkedReview = { id: "review_1", repositoryId: "repo_1", headRunId: "run_1" };
    const arrays = [
      ["reviewAudit", "reviews"],
      ["reviewAudit", "auditEvents"],
      ["reviewComments", "comments"],
      ["reviewWorkflow", "approvals"],
      ["reviewWorkflow", "checklistItems"],
      ["findingCollaboration", "decisions"],
      ["findingCollaboration", "assignments"],
    ] as const;
    for (const [key, field] of arrays) {
      const original = JSON.parse(input.slices[key].bytes.toString("utf8")) as Record<string, unknown>;
      const child = {
        id: "record_1",
        repositoryId: "repo_1",
        ...(key === "reviewAudit" ? {} : { reviewId: "review_1" }),
        ...(field === "approvals" ? { revisionId: "revision_1" } : {}),
      };
      const updated = slice({ ...original, [field]: [child] });
      const audit =
        key === "reviewAudit"
          ? updated
          : slice({
              ...originalAudit,
              reviews: [linkedReview],
              revisions: [{ id: "revision_1", reviewId: "review_1" }],
            });
      expect(
        () =>
          prepareClaimedArchiveEntries({
            ...input,
            slices: { ...input.slices, reviewAudit: audit, [key]: updated },
          }),
        `${key}.${field}`,
      ).not.toThrow();
    }
  });

  it("rejects absent, oversized or malformed scoped record collections", () => {
    const { input } = fixture();
    const original = JSON.parse(input.slices.reviewComments.bytes.toString("utf8")) as Record<string, unknown>;
    for (const comments of [null, {}, "invalid", Array(101).fill({ id: "record_1", repositoryId: "repo_1" }), [null]]) {
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          slices: { ...input.slices, reviewComments: slice({ ...original, comments }) },
        }),
      ).toThrow(ExportArchivePreflightError);
    }
    const missing = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    delete missing.revisions;
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, reviewAudit: slice(missing) },
      }),
    ).toThrow(ExportArchivePreflightError);
  });

  it("rejects orphaned, duplicate, or wrongly attached review revisions", () => {
    const { input } = fixture();
    const review = { id: "review_1", repositoryId: "repo_1", headRunId: "run_1" };
    const revision = { id: "revision_1", reviewId: "review_missing", headRunId: "run_1" };
    const base = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    const cases = [
      { ...base, reviews: [review], revisions: [revision] },
      {
        ...base,
        reviews: [review],
        revisions: [
          { ...revision, reviewId: review.id },
          { ...revision, reviewId: review.id },
        ],
      },
      { ...base, reviews: [review], revisions: [{ ...revision, reviewId: 123 }] },
    ];
    for (const changed of cases) {
      expect(() =>
        prepareClaimedArchiveEntries({
          ...input,
          slices: { ...input.slices, reviewAudit: slice(changed) },
        }),
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("accepts revisions linked to the same in-scope review snapshot", () => {
    const { input } = fixture();
    const base = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    const changed = {
      ...base,
      reviews: [{ id: "review_1", repositoryId: "repo_1", headRunId: "run_1" }],
      revisions: [{ id: "revision_1", reviewId: "review_1", headRunId: "run_1" }],
    };
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, reviewAudit: slice(changed) },
      }),
    ).not.toThrow();
  });

  it("rejects review-linked records without a matching review and repository", () => {
    const { input } = fixture();
    const reviewAudit = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    input.slices.reviewAudit = slice({
      ...reviewAudit,
      reviews: [{ id: "review_1", repositoryId: "repo_1", headRunId: "run_1" }],
      revisions: [{ id: "revision_1", reviewId: "review_1", headRunId: "run_1" }],
    });
    const cases = [
      ["reviewComments", "comments"],
      ["reviewWorkflow", "approvals"],
      ["reviewWorkflow", "checklistItems"],
      ["findingCollaboration", "decisions"],
      ["findingCollaboration", "assignments"],
    ] as const;
    for (const [key, field] of cases) {
      const original = JSON.parse(input.slices[key].bytes.toString("utf8")) as Record<string, unknown>;
      for (const row of [
        { id: "child_1", repositoryId: "repo_1", reviewId: "review_missing" },
        { id: "child_1", repositoryId: "repo_2", reviewId: "review_1" },
        { id: "child_1", repositoryId: "repo_1", reviewId: null },
      ]) {
        const updated = slice({ ...original, [field]: [row] });
        expect(
          () =>
            prepareClaimedArchiveEntries({
              ...input,
              slices: { ...input.slices, [key]: updated },
            }),
          `${key}.${field} ${JSON.stringify(row)}`,
        ).toThrow(ExportArchivePreflightError);
      }
    }
  });

  it("accepts child metadata linked to the correct review repository", () => {
    const { input } = fixture();
    const reviewAudit = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    input.slices.reviewAudit = slice({
      ...reviewAudit,
      reviews: [{ id: "review_1", repositoryId: "repo_1", headRunId: "run_1" }],
      revisions: [{ id: "revision_1", reviewId: "review_1", headRunId: "run_1" }],
    });
    const cases = [
      ["reviewComments", "comments"],
      ["reviewWorkflow", "approvals"],
      ["reviewWorkflow", "checklistItems"],
      ["findingCollaboration", "decisions"],
      ["findingCollaboration", "assignments"],
    ] as const;
    for (const [key, field] of cases) {
      const original = JSON.parse(input.slices[key].bytes.toString("utf8")) as Record<string, unknown>;
      const row = {
        id: "child_1",
        repositoryId: "repo_1",
        reviewId: "review_1",
        ...(field === "approvals" ? { revisionId: "revision_1" } : {}),
      };
      expect(
        () =>
          prepareClaimedArchiveEntries({
            ...input,
            slices: { ...input.slices, [key]: slice({ ...original, [field]: [row] }) },
          }),
        `${key}.${field}`,
      ).not.toThrow();
    }
  });

  it("rejects an approval targeting a missing or another review's revision", () => {
    const { input } = fixture();
    const audit = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    input.slices.reviewAudit = slice({
      ...audit,
      reviews: [
        { id: "review_1", repositoryId: "repo_1", headRunId: "run_1" },
        { id: "review_2", repositoryId: "repo_1", headRunId: "run_1" },
      ],
      revisions: [
        { id: "revision_1", reviewId: "review_1" },
        { id: "revision_2", reviewId: "review_2" },
      ],
    });
    const workflow = JSON.parse(input.slices.reviewWorkflow.bytes.toString("utf8")) as Record<string, unknown>;
    for (const revisionId of ["revision_2", "missing_revision", "", null]) {
      const changed = slice({
        ...workflow,
        approvals: [{ id: "approval_1", repositoryId: "repo_1", reviewId: "review_1", revisionId }],
      });
      expect(
        () =>
          prepareClaimedArchiveEntries({
            ...input,
            slices: { ...input.slices, reviewWorkflow: changed },
          }),
        String(revisionId),
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("allows an approval only when its revision belongs to the referenced review", () => {
    const { input } = fixture();
    const audit = JSON.parse(input.slices.reviewAudit.bytes.toString("utf8")) as Record<string, unknown>;
    input.slices.reviewAudit = slice({
      ...audit,
      reviews: [{ id: "review_1", repositoryId: "repo_1", headRunId: "run_1" }],
      revisions: [{ id: "revision_1", reviewId: "review_1" }],
    });
    const workflow = JSON.parse(input.slices.reviewWorkflow.bytes.toString("utf8")) as Record<string, unknown>;
    const updated = slice({
      ...workflow,
      approvals: [{ id: "approval_1", repositoryId: "repo_1", reviewId: "review_1", revisionId: "revision_1" }],
    });
    expect(() =>
      prepareClaimedArchiveEntries({
        ...input,
        slices: { ...input.slices, reviewWorkflow: updated },
      }),
    ).not.toThrow();
  });

  it("rejects foreign-repository records in every review and collaboration slice", () => {
    const { input } = fixture();
    const cases = [
      ["reviewAudit", "reviews"],
      ["reviewAudit", "auditEvents"],
      ["reviewComments", "comments"],
      ["reviewWorkflow", "approvals"],
      ["reviewWorkflow", "checklistItems"],
      ["findingCollaboration", "decisions"],
      ["findingCollaboration", "assignments"],
    ] as const;
    for (const [key, field] of cases) {
      const original = JSON.parse(input.slices[key].bytes.toString("utf8")) as Record<string, unknown>;
      const changed = slice({ ...original, [field]: [{ id: "record_1", repositoryId: "foreign-repo" }] });
      expect(
        () =>
          prepareClaimedArchiveEntries({
            ...input,
            slices: { ...input.slices, [key]: changed },
          }),
        `${key}.${field}`,
      ).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects artifacts attached to out-of-scope runs or repositories", () => {
    const { input } = fixture();
    input.slices.records = slice({
      runs: [{ id: "run_1", repositoryId: "foreign-repo" }],
    }) as Input["slices"]["records"];
    expect(() => prepareClaimedArchiveEntries(input)).toThrow(ExportArchivePreflightError);
  });

  it("does not copy untrusted artifact identifiers into traversal-capable paths", () => {
    const { input } = fixture();
    for (const id of ["../other", "a/b", "a\\b", "", ".".repeat(129)]) {
      input.slices.artifactMetadata = slice({
        artifacts: [{ ...fixture().metadata, id }],
      }) as Input["slices"]["artifactMetadata"];
      expect(() => prepareClaimedArchiveEntries(input)).toThrow(ExportArchivePreflightError);
    }
  });

  it("rejects duplicate and malformed repository or run identifiers", () => {
    const { input } = fixture();
    for (const data of [
      {
        runs: [
          { id: "run_1", repositoryId: "repo_1" },
          { id: "run_1", repositoryId: "repo_1" },
        ],
      },
      { runs: [null] },
      { runs: "invalid" },
    ]) {
      const changed = { ...input.slices, records: slice(data) };
      expect(() => prepareClaimedArchiveEntries({ ...input, slices: changed })).toThrow(ExportArchivePreflightError);
    }
    const changed = { ...input.slices, repositories: slice({ repositories: null }) };
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: changed })).toThrow(ExportArchivePreflightError);
  });

  it("requires authentic JSON metadata and never trusts an untyped payload", () => {
    const { input } = fixture();
    const badContentType = { ...input.slices.reviewAudit, contentType: "text/plain" } as Input["slices"]["reviewAudit"];
    expect(() =>
      prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: badContentType } }),
    ).toThrow(ExportArchivePreflightError);
    const badShape = { ...input.slices, artifactMetadata: slice(null) };
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: badShape })).toThrow(ExportArchivePreflightError);
  });

  it("rejects mutated, truncated or overbudget metadata", () => {
    const { input } = fixture();
    const original = input.slices.reviewAudit;
    const mutated = { ...original, bytes: Buffer.from(original.bytes) };
    mutated.bytes[0] ^= 1;
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: mutated } })).toThrow(
      ExportArchivePreflightError,
    );
    const wrongLength = { ...original, byteLength: original.byteLength + 1 };
    expect(() =>
      prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: wrongLength } }),
    ).toThrow(ExportArchivePreflightError);
    const huge = slice({ blob: "x".repeat(256 * 1024) });
    expect(() => prepareClaimedArchiveEntries({ ...input, slices: { ...input.slices, reviewAudit: huge } })).toThrow(
      ExportArchivePreflightError,
    );
  });
});
