import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../../.github/workflows/readiness-runner.yml", import.meta.url), "utf8");

describe("opt-in private manufacturing archive upload", () => {
  it("keeps private object storage disabled unless the target repository explicitly opts in", () => {
    expect(workflow).toContain("vars.BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE == 'true'");
    expect(workflow).toContain("id: manufacturing-object-import");
    expect(workflow).toContain("steps.manufacturing-attestation.outcome == 'success'");
    expect(workflow).toContain("vars.BOARDREADYOPS_MANUFACTURING_TEMP_ARTIFACTS != 'true'");
  });

  it("uses source-bound OIDC and a small JSON handshake rather than posting archive bytes to the web API", () => {
    expect(workflow).toContain("boardreadyops-manufacturing-export:");
    expect(workflow).toContain("/manufacturing-export/object");
    expect(workflow).toContain('operation: "prepare"');
    expect(workflow).toContain('operation: "commit"');
    expect(workflow).toContain("x-amz-checksum-sha256");
    expect(workflow).toContain("body: archive");
  });

  it("preserves current GitHub and VPS modes when the object-storage switch is unset", () => {
    expect(workflow).toContain("id: manufacturing-temporary-artifact");
    expect(workflow).toContain("id: manufacturing-export-import");
    expect(workflow).toContain("vars.BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE != 'true'");
  });
});
