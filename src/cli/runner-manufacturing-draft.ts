import path from "node:path";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";
import { discoverProjects } from "../core/discovery.js";
import { detectKicadCli } from "../kicad/cli.js";
import { createKicadCliRunner, runGenerate } from "../release/generate.js";
import { createVerifiedManufacturingZip } from "../release/manufacturing-archive.js";
import type { RunnerExecutionArtifact } from "../runner/worker.js";

/**
 * Explicit opt-in only. Draft archives are not approved manufacturing evidence,
 * signed deliveries, or eligible to issue guest manufacturing links.
 */
export async function prepareRunnerManufacturingDraft(
  workspace: string,
  job: RunnerClaimedJob,
  options: { requireKicad: boolean; signal?: AbortSignal },
): Promise<RunnerExecutionArtifact> {
  options.signal?.throwIfAborted();
  if (
    job.safeMode.enabled ||
    job.repository.private ||
    job.sourceMode !== "customer_checkout" ||
    !options.requireKicad
  ) {
    throw new Error("Manufacturing draft upload requires an authorized public, non-safe-mode KiCad checkout");
  }
  const projects = await discoverProjects(workspace);
  if (projects.length !== 1 || !projects[0]?.boardFiles[0]) {
    throw new Error("Manufacturing draft requires exactly one KiCad project with a PCB");
  }
  const cli = await detectKicadCli();
  if (!cli.path || !cli.found || !/^10[.]0[.]/u.test(cli.version ?? "")) {
    throw new Error("Manufacturing draft requires KiCad CLI version 10.0.x");
  }
  options.signal?.throwIfAborted();
  // This runs BEFORE analysis creates an untracked report. The reviewed-source
  // preflight rejects stale, altered and otherwise dirty checkouts.
  const generated = await runGenerate(
    { schemaVersion: 1, steps: [{ kind: "gerbers" }, { kind: "drill" }] },
    {
      outputDir: path.join(workspace, ".boardreadyops-runner", job.executionAttemptId, "manufacturing", "outputs"),
      boardFile: path.resolve(workspace, projects[0].boardFiles[0]),
      gitRoot: workspace,
      reviewedSourceSha: job.repository.commitSha,
      kicadVersion: cli.version,
      runner: createKicadCliRunner(cli.path),
    },
  );
  options.signal?.throwIfAborted();
  if (generated.failures !== 0) throw new Error("KiCad draft manufacturing export failed");
  const zip = await createVerifiedManufacturingZip({
    root: workspace,
    generated,
    sourceCommitSha: job.repository.commitSha,
    destination: path.join(workspace, ".boardreadyops-runner", job.executionAttemptId, "manufacturing-draft.zip"),
  });
  return {
    kind: "archive",
    name: "boardreadyops-manufacturing-draft.zip",
    role: "draft-manufacturing", // Intentionally never "manufacturing" (which is a delivery-eligibility signal).
    contentType: "application/zip",
    filePath: zip.path,
    bytes: zip.bytes,
    sha256: zip.sha256,
  };
}
