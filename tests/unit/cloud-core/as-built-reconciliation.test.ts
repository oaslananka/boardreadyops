import { describe, expect, it } from "vitest";
import {
  type AsBuiltComparisonInput,
  type BomPart,
  compareApprovedAndBuiltBom,
} from "../../../packages/cloud-core/src/as-built-reconciliation.js";

const u1: BomPart = { reference: "U1", mpn: "ABC-1", manufacturer: "Semico", footprint: "QFN-32", quantity: 1 };
const r1: BomPart = { reference: "R1", mpn: "RES-100", manufacturer: "ResistorCo", footprint: "0603", quantity: 3 };
const jp1: BomPart = {
  reference: "JP1",
  mpn: "JMP",
  manufacturer: "Jumper",
  footprint: "0402",
  quantity: 1,
  dnp: true,
};
const approved: BomPart[] = [u1, r1, jp1];
const built: BomPart[] = [u1, r1];
const baseline: AsBuiltComparisonInput = {
  approvedRelease: { id: "release-1", repositoryId: "repo-1", commitSha: "a".repeat(40), snapshotId: "bom-1" },
  productionBatch: { id: "batch-1", externalBatchId: "LOT-01", sourceSha256: "b".repeat(64) },
  approved,
  built,
};

describe("as-built BOM reconciliation foundation", () => {
  it("reports matching supplied component records, not unverified shipment claims", () => {
    const report = compareApprovedAndBuiltBom(baseline);
    expect(report).toMatchObject({
      releaseId: "release-1",
      repositoryId: "repo-1",
      approvedCommitSha: "a".repeat(40),
      approvedSnapshotId: "bom-1",
      batchId: "batch-1",
      batchSourceSha256: "b".repeat(64),
      status: "matching_records",
      divergences: [],
    });
  });

  it("does not certify empty approved BOM evidence as a matching shipment record", () => {
    const empty = compareApprovedAndBuiltBom({ ...baseline, approved: [], built: [] });
    expect(empty.status).toBe("insufficient_identity");
    expect(empty.divergences).toEqual([]);

    const missingBaseline = compareApprovedAndBuiltBom({ ...baseline, approved: [], built: [u1] });
    expect(missingBaseline.status).toBe("insufficient_identity");
    expect(missingBaseline.divergences[0]?.kind).toBe("additional_part");
  });

  it("distinguishes a listed alternate from documented proof of approval", () => {
    const replacement = { ...u1, mpn: "XYZ-2", manufacturer: "OtherFab" };
    const report = compareApprovedAndBuiltBom({
      ...baseline,
      built: [replacement, r1],
      documentedAlternates: [
        {
          primaryMpn: "abc-1",
          alternateMpn: " xyz-2 ",
          alternateManufacturer: "otherfab",
          policyId: "policy-rev-A",
        },
      ],
    });
    expect(report.status).toBe("different_records");
    expect(report.divergences).toEqual([
      {
        reference: "U1",
        kind: "part_substitution",
        approved: approved[0],
        built: replacement,
        candidatePolicyId: "policy-rev-A",
      },
    ]);
  });

  it("does not treat an unrelated or ambiguous alternate as authorized", () => {
    const replacement = { ...u1, mpn: "XYZ-2", manufacturer: "OtherFab" };
    const entry = { primaryMpn: "ABC-1", alternateMpn: "XYZ-2", policyId: "candidate" };
    const report = compareApprovedAndBuiltBom({
      ...baseline,
      built: [replacement, r1],
      documentedAlternates: [entry, { ...entry, policyId: "different-policy" }],
    });
    expect(report.divergences[0]?.candidatePolicyId).toBeUndefined();
    const other = compareApprovedAndBuiltBom({
      ...baseline,
      built: [replacement, r1],
      documentedAlternates: [{ ...entry, alternateManufacturer: "wrong-company" }],
    });
    expect(other.divergences[0]?.candidatePolicyId).toBeUndefined();
  });

  it("surfaces missing, added and assembled-DNP references without pretending that they match", () => {
    const report = compareApprovedAndBuiltBom({
      ...baseline,
      built: [
        u1,
        { ...jp1, dnp: false },
        { reference: "C9", mpn: "CAP-1", manufacturer: "CapFab", footprint: "0603", quantity: 1 },
      ],
    });
    expect(report.divergences.map((entry) => [entry.reference, entry.kind])).toEqual([
      ["C9", "additional_part"],
      ["JP1", "unexpected_assembly"],
      ["R1", "missing_populated_part"],
    ]);
  });

  it("records footprint and quantity divergence independently from part-number substitution", () => {
    const changed = { ...u1, mpn: "xyz-2", footprint: "BGA-49", quantity: 2 };
    const report = compareApprovedAndBuiltBom({ ...baseline, built: [changed, r1] });
    expect(report.divergences.map((entry) => entry.kind)).toEqual([
      "part_substitution",
      "footprint_difference",
      "quantity_difference",
    ]);
  });

  it("never treats missing MPN, manufacturer or quantity as clean match", () => {
    const report = compareApprovedAndBuiltBom({
      ...baseline,
      built: [{ ...u1, mpn: undefined, quantity: undefined }, r1],
    });
    expect(report.status).toBe("insufficient_identity");
    expect(report.divergences.filter((entry) => entry.kind === "identity_incomplete")).toHaveLength(2);
  });

  it("marks a one-sided missing footprint as unknown rather than a verified footprint change", () => {
    const report = compareApprovedAndBuiltBom({
      ...baseline,
      built: [{ ...u1, footprint: undefined }, r1],
    });
    expect(report.status).toBe("insufficient_identity");
    expect(report.divergences.map((item) => item.kind)).toEqual(["identity_incomplete"]);
  });

  it("rejects duplicate or malformed reference identities, including case aliases", () => {
    expect(() =>
      compareApprovedAndBuiltBom({
        ...baseline,
        built: [u1, { ...u1, reference: "u1" }],
      }),
    ).toThrow("duplicate BOM reference U1");
    expect(() => compareApprovedAndBuiltBom({ ...baseline, built: [{ ...u1, reference: " " }] })).toThrow(
      "BOM reference must be a bounded nonempty identity",
    );
  });

  it("rejects invalid quantities and unbound release/batch digests", () => {
    expect(() =>
      compareApprovedAndBuiltBom({
        ...baseline,
        built: [{ ...u1, quantity: -1 }],
      }),
    ).toThrow("invalid quantity");
    expect(() =>
      compareApprovedAndBuiltBom({
        ...baseline,
        approvedRelease: { ...baseline.approvedRelease, commitSha: "bad" },
      }),
    ).toThrow("Approved commit SHA");
    expect(() =>
      compareApprovedAndBuiltBom({
        ...baseline,
        productionBatch: { ...baseline.productionBatch, sourceSha256: "bad" },
      }),
    ).toThrow("Batch source digest");
  });

  it("preserves deterministic reference ordering for cross-batch investigations", () => {
    const reversed = compareApprovedAndBuiltBom({
      ...baseline,
      built: [
        { ...r1, quantity: 5 },
        { ...u1, mpn: "replacement" },
      ],
    });
    expect(reversed.divergences.map((entry) => entry.reference)).toEqual(["R1", "U1"]);
  });
});
