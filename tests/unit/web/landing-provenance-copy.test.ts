import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../../apps/web/app/page.tsx", import.meta.url), "utf8");

describe("public manufacturing evidence claims (#445 / #771)", () => {
  it("distinguishes a digest inventory from authenticated source-to-export provenance", () => {
    expect(source).toContain("without an independently verified export attestation");
    expect(source).toContain("trusted same-run attestation");
    expect(source).toContain("Those checks alone cannot establish");
    expect(source).toContain("Only a trusted, verified export attestation");
  });

  it("does not promise production outcomes or claim unchecked artifacts match the reviewed commit", () => {
    const unsupportedClaims = [
      "Each package manifest guarantees",
      "This guarantees reproducible fabrication audits",
      "Every check run cryptographically binds",
      "automated checks ensure all plated holes",
      "prevents expensive fabrication scrap",
      "package is complete, current, and matches the evaluated commit",
      "Every result traces back to a versioned file",
    ];
    for (const claim of unsupportedClaims) {
      expect(source.toLowerCase()).not.toContain(claim.toLowerCase());
    }
  });

  it("describes optional hosted storage and never implies customer compliance is automatic", () => {
    expect(source).toContain("normalized findings, run metadata, audit events and optional managed artifacts");
    expect(source).toContain("not a certification, compliance finding");
    expect(source).not.toContain("does not take custody of anything");
    expect(source).not.toContain("documented, auditable compliance");
  });

  it("keeps reproducible source fixtures and setup paths discoverable", () => {
    expect(source).toContain("boardreadyops/tree/main/examples/golden-demo/fixed");
    expect(source).toContain("boardreadyops/tree/main/examples/golden-demo/broken");
    expect(source).toContain("installUrl");
    expect(source).toContain("https://docs.boardreadyops.com/security/assurance-case/");
  });
});
