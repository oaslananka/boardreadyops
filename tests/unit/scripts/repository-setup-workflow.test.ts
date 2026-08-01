import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const workflow = new URL("../../../.github/workflows/readiness-runner.yml", import.meta.url);
const expression = (value: string) => `$${value}`;

describe("repository setup workflow probe", () => {
  it("keeps normal execution isolated from setup probes", async () => {
    const document = yaml.load(await readFile(workflow, "utf8")) as Record<string, unknown>;
    const jobs = document.jobs as Record<string, Record<string, unknown>>;
    expect(jobs.readiness?.if).toBe(expression("{{ inputs.setup_probe_id == '' }}"));
    expect(jobs["setup-probe"]?.if).toBe(expression("{{ inputs.setup_probe_id != '' }}"));
  });

  it("validates the default-branch config and publishes a run-bound OIDC result", async () => {
    const source = await readFile(workflow, "utf8");
    expect(source).toContain("repository: oaslananka/boardreadyops");
    expect(source).toContain("ref: ce925376bd71daf7e07f31fb1bb19a8bde30b172 # v1.24.1");
    expect(source).toContain(
      'node "$GITHUB_WORKSPACE/.boardreadyops-tool/dist/cli/index.cjs" doctor --check repository --format json',
    );
    expect(source).toContain("CONFIG_PATH must stay within the checked-out repository");
    expect(source).not.toContain("npm exec");
    expect(source).not.toContain("boardreadyops@1.23.0");
    expect(source).toContain(`boardreadyops-setup:$${"{probeId}"}`);
    expect(source).toContain(`/api/v1/setup-probes/result?probe_id=$${"{SETUP_PROBE_ID}"}`);
    expect(source).toContain("persist-credentials: false");
    expect(source).not.toContain("contents: write");
  });
});
