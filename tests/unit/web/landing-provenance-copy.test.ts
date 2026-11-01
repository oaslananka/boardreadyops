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

  it("describes electrical checks without promising independent cross-netlist verification", () => {
    expect(source).toContain("runs KiCad ERC on schematics and DRC on PCB layouts");
    expect(source).toContain("do not independently prove schematic-to-PCB netlist equivalence");
    expect(source).not.toContain("deep structural netlist comparison");
    expect(source).not.toContain("missing pull-up resistor triggers a blocking finding");
  });

  it("keeps exchange-format and assembly claims within implemented checks", () => {
    expect(source).toContain("supported IPC-2581 data");
    expect(source).toContain("ODB++ schema validation");
    expect(source).toContain("can flag custom footprints for manual pin-1 marker review");
    expect(source).not.toContain("BoardReadyOps validates schema conformance and cross-checks layer definitions");
    expect(source).not.toContain("verifies pin 1 rotation conventions");
  });

  it("describes mask coverage and stackup count without promising fab geometry certification", () => {
    expect(source).toContain("matching solder-mask layers on copper sides");
    expect(source).toContain("does not measure solder-mask web clearance");
    expect(source).toContain("compares the parsed PCB stackup layer count");
    expect(source).toContain("does not independently verify impedance");
    expect(source).not.toContain("catches tight-pitch pad clearances that violate vendor mask capability");
    expect(source).not.toContain("verifies that PCB stackup tables in drawings match");
  });

  it("limits Gerber geometry, Check Run annotations and evidence claims to available evidence", () => {
    expect(source).toContain("complex Gerber aperture macros and blocks may remain unmodelled");
    expect(source).toContain("annotates supported findings when a source file and line location are available");
    expect(source).toContain("where those details are recorded");
    expect(source).not.toContain("Every verification assertion records timestamp");
    expect(source).not.toContain("Annotations appear inline on changed layout or schematic files");
  });

  it("links public PASS and BLOCK PRs to actual App verdicts and Actions runs (#445)", () => {
    expect(source).toContain("boardreadyops/boardreadyops-e2e-public/pull/4");
    expect(source).toContain("boardreadyops/boardreadyops-e2e-public/pull/5");
    expect(source).toContain("boardreadyops-e2e-public/actions/runs/41347650029");
    expect(source).toContain("boardreadyops-e2e-public/actions/runs/41347645773");
    expect(source).toContain("/runs/9ab5ab15-0db0-4b22-b923-ac434da4ebee");
    expect(source).toContain("/runs/74c7f60f-0779-4f48-bfe0-2fc07360565b");
    expect(source).toContain("reproducible demonstrations, not");
    expect(source).toContain("customer manufacturing evidence or a fabrication approval");
    expect(source).not.toContain("These links are source fixtures, not");
  });

  it("keeps reproducible source fixtures and setup paths discoverable", () => {
    expect(source).toContain("boardreadyops/tree/main/examples/golden-demo/fixed");
    expect(source).toContain("boardreadyops/tree/main/examples/golden-demo/broken");
    expect(source).toContain("installUrl");
    expect(source).toContain("https://docs.boardreadyops.com/security/assurance-case/");
  });
});
