import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/readiness-runner.yml");

describe("readiness runner workflow security contract", () => {
  it("executes the exact target commit on a GitHub-hosted runner with KiCad", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("ref: $" + "{{ inputs.head_sha }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain('actual_sha="$(git rev-parse HEAD)"');
    expect(workflow).toContain("ppa:kicad/kicad-10.0-releases");
    expect(workflow).toContain('require-kicad: "true"');
    expect(workflow).toContain("project: $" + "{{ vars.BOARDREADYOPS_PROJECT || '' }}");
    expect(workflow).toContain("config: $" + "{{ vars.BOARDREADYOPS_CONFIG || 'boardreadyops.yml' }}");
    expect(workflow).toContain("uses: oaslananka/boardreadyops@155afd28bbbadf7d11723629b4f71675288a9e02");
    expect(workflow).not.toContain("runner-ready");
  });

  it("uses GitHub OIDC without a shared cloud secret", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("id: validate");
    expect(workflow).toContain("if: always() && steps.validate.outcome == 'success'");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("const oidcToken = await core.getIDToken(audience)");
    expect(workflow).toContain("authorization: `Bearer $" + "{oidcToken}`");
    expect(workflow).toContain("boardreadyops-cloud:$" + "{runId}:$" + "{executionAttemptId}");
    expect(workflow).not.toContain("BRO_RUNNER_KEY");
    expect(workflow).not.toContain("BOARDREADYOPS_RUNNER_RESULT_KEY");
  });

  it("publishes findings, metrics, and the GitHub Actions run link", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain('const reportPath = "boardreadyops.findings.json"');
    expect(workflow).toContain("version: 1");
    expect(workflow).toContain("executionAttemptId");
    expect(workflow).toContain("const reportAvailable =");
    expect(workflow).toContain("const operationalFailure = !reportAvailable");
    expect(workflow).toContain("const findings = rawFindings.slice(0, 500)");
    expect(workflow).toContain('Buffer.byteLength(JSON.stringify(payload), "utf8") > 900 * 1024');
    expect(workflow).toContain("findings_total:");
    expect(workflow).toContain('label: "GitHub Actions run"');
    expect(workflow).toContain("for (let attempt = 1; attempt <= 3; attempt += 1)");
    expect(workflow).toContain("core.setFailed(policyFailed");
  });

  it("binds dispatch to this repository, the exact SHA, and the production callback", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("run_id must be a lowercase UUID");
    expect(workflow).toContain("execution_attempt_id must be a lowercase UUID");
    expect(workflow).toContain('if [ "$TARGET" != "$GITHUB_REPOSITORY" ]');
    expect(workflow).toContain('[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain(
      'expected_url="$' +
        "{CLOUD_ORIGIN}/api/v1/runs/github-actions-result?run_id=$" +
        "{RUN_ID}&attempt_id=$" +
        '{EXECUTION_ATTEMPT_ID}"',
    );
    expect(workflow).toContain("BOARDREADYOPS_CLOUD_ORIGIN must be an HTTPS origin");
    expect(workflow).toContain('if [ "$RESULT_URL" != "$expected_url" ]');
  });

  it("requires execution-attempt binding and validates safe-mode metadata", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const executionAttemptInput = workflow.slice(
      workflow.indexOf("execution_attempt_id:"),
      workflow.indexOf("target:"),
    );

    expect(executionAttemptInput).toContain("required: true");
    expect(executionAttemptInput).not.toContain('default: ""');
    expect(workflow).toContain("safe_mode must be true or false");
    expect(workflow).toContain("safe_mode_reasons requires safe_mode=true");
    expect(workflow).toContain("safe_mode=true requires at least one reason");
    expect(workflow).toContain("draft-pull-request|fork-pull-request|private-repository");
    expect(workflow).toContain("duplicate safe-mode reason");
  });
});
