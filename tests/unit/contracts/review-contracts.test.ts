import { describe, expect, it } from "vitest";
import {
  createFindingDecisionRequestSchema,
  findingDiffStates,
  findingDispositions,
  reviewDecisions,
  reviewStatuses,
  uploadManifestSchema,
  uploadModes,
} from "../../../packages/contracts/src/review.js";

describe("Review and Evidence Domain Contracts", () => {
  it("strictly validates allowed enums", () => {
    expect(findingDiffStates).toEqual(["new", "persistent", "regressed", "resolved"]);
    expect(findingDispositions).toEqual(["open", "fixed", "accepted_risk", "false_positive", "not_applicable"]);
    expect(reviewDecisions).toEqual(["pending", "approved", "changes_requested"]);
    expect(reviewStatuses).toEqual(["draft", "active", "awaiting_decision", "completed", "superseded"]);
    expect(uploadModes).toEqual(["metadata", "snapshots", "source"]);
  });

  it("requires at least 20 characters for accepted_risk disposition reason", () => {
    const validDigest = "a".repeat(64);
    const shortReasonResult = createFindingDecisionRequestSchema.safeParse({
      disposition: "accepted_risk",
      reason: "too short",
      evidenceDigest: validDigest,
    });
    expect(shortReasonResult.success).toBe(false);

    const validReasonResult = createFindingDecisionRequestSchema.safeParse({
      disposition: "accepted_risk",
      reason: "This is a comprehensive engineering waiver explanation with sufficient detail.",
      evidenceDigest: validDigest,
    });
    expect(validReasonResult.success).toBe(true);
  });

  it("permits shorter reason for other dispositions like false_positive or fixed", () => {
    const validDigest = "b".repeat(64);
    const fpResult = createFindingDecisionRequestSchema.safeParse({
      disposition: "false_positive",
      reason: "Known issue",
      evidenceDigest: validDigest,
    });
    expect(fpResult.success).toBe(true);
  });

  it("rejects invalid 64-char lowercase SHA-256 digests", () => {
    const uppercaseDigest = "A".repeat(64);
    const shortDigest = "abc";
    expect(
      createFindingDecisionRequestSchema.safeParse({
        disposition: "fixed",
        reason: "Fixed in layout",
        evidenceDigest: uppercaseDigest,
      }).success,
    ).toBe(false);

    expect(
      createFindingDecisionRequestSchema.safeParse({
        disposition: "fixed",
        reason: "Fixed in layout",
        evidenceDigest: shortDigest,
      }).success,
    ).toBe(false);
  });

  it("rejects manifest containing source items if uploadMode is not 'source'", () => {
    const validDigest = "0".repeat(64);
    const invalidManifest = {
      schemaVersion: 1,
      uploadMode: "metadata",
      repositoryId: "repo-123",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      toolVersion: "1.34.0",
      configDigest: validDigest,
      rulePackDigest: validDigest,
      items: [
        {
          kind: "schematic",
          path: "board.kicad_sch",
          contentType: "application/x-kicad-schematic",
          bytes: 4096,
          sha256: validDigest,
          dataClass: "source",
        },
      ],
    };

    const parsed = uploadManifestSchema.safeParse(invalidManifest);
    expect(parsed.success).toBe(false);

    const validSourceManifest = {
      ...invalidManifest,
      uploadMode: "source",
    };
    expect(uploadManifestSchema.safeParse(validSourceManifest).success).toBe(true);
  });
});
