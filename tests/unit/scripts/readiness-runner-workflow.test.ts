import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/readiness-runner.yml");
const shellExpansion = (expression: string): string => ["$", "{", expression, "}"].join("");

describe("readiness runner workflow security contract", () => {
  it("uses GitHub OIDC without the retired shared secret", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(workflow).toContain("authorization: Bearer $oidc_token");
    expect(workflow).toContain(
      `audience="boardreadyops-cloud:${shellExpansion("RUN_ID")}:${shellExpansion("EXECUTION_ATTEMPT_ID")}"`,
    );
    expect(workflow).not.toContain("BRO_RUNNER_KEY");
  });

  it("validates run binding, target shape, and callback destination", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("run_id must be a lowercase UUID");
    expect(workflow).toContain("execution_attempt_id must be a lowercase UUID");
    expect(workflow).toContain(`target_owner="${shellExpansion("TARGET%%/*")}"`);
    expect(workflow).toContain(`target_repository="${shellExpansion("TARGET#*/")}"`);
    expect(workflow).toContain(`"${shellExpansion("#target_owner")}" -gt 39`);
    expect(workflow).toContain(`"${shellExpansion("#target_repository")}" -gt 100`);
    expect(workflow).toContain(
      `expected_url="https://boardreadyops.oaslananka.dev/api/v1/runs/result?run_id=${shellExpansion("RUN_ID")}&attempt_id=${shellExpansion("EXECUTION_ATTEMPT_ID")}"`,
    );
    expect(workflow).toContain('[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]');
  });

  it("keeps the legacy callback shape available during the rolling upgrade", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("execution_attempt_id:");
    expect(workflow).toContain('default: ""');
    expect(workflow).toContain(`audience="boardreadyops-cloud:${shellExpansion("RUN_ID")}"`);
    expect(workflow).toContain(
      `expected_url="https://boardreadyops.oaslananka.dev/api/v1/runs/result?run_id=${shellExpansion("RUN_ID")}"`,
    );
  });

  it("allows only consistent, known safe-mode inputs", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("safe_mode must be true or false");
    expect(workflow).toContain("safe_mode_reasons requires safe_mode=true");
    expect(workflow).toContain("safe_mode=true requires at least one reason");
    expect(workflow).toContain("draft-pull-request|fork-pull-request|private-repository");
    expect(workflow).toContain("duplicate safe-mode reason");
  });
});
