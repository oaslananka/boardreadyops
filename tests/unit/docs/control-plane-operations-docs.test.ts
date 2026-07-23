import fs from "node:fs";
import { describe, expect, it } from "vitest";

const documentationPath = "docs/operations/control-plane-reconciliation.md";

describe("control-plane operator documentation", () => {
  it("documents the authenticated dead-letter operator contract", () => {
    expect(fs.existsSync(documentationPath)).toBe(true);
    const documentation = fs.existsSync(documentationPath) ? fs.readFileSync(documentationPath, "utf8") : "";
    expect(documentation).toContain("BOARDREADYOPS_OPERATOR_API_TOKEN");
    expect(documentation).toContain("BOARDREADYOPS_OPERATOR_ACTOR_ID");
    expect(documentation).toContain("GET /api/v1/operator/installations/{installationId}/dead-letters");
    expect(documentation).toContain(
      "POST /api/v1/operator/installations/{installationId}/dead-letters/{itemType}/{itemId}/replay",
    );
    expect(documentation).toContain("Idempotency-Key");
    expect(documentation).toContain("private network");
    expect(documentation).toContain("audit event");
  });

  it("keeps deploy configuration and public navigation synchronized", () => {
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_OPERATOR_API_TOKEN=");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_OPERATOR_ACTOR_ID=");

    const navigation = fs.readFileSync("mkdocs.yml", "utf8");
    expect(navigation).toContain("Control-plane Reconciliation: operations/control-plane-reconciliation.md");
  });
});
