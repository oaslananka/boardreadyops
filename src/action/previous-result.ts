import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as github from "@actions/github";
import type { FabricationSnapshot } from "../core/diff/fabrication.js";
import type { HardwareImpactBaselineReason } from "../core/diff/hardware-impact.js";
import type { Finding } from "../core/findings.js";
import type { RunResult } from "../core/result.js";

type PullRequestPayload = NonNullable<typeof github.context.payload.pull_request>;
type Octokit = ReturnType<typeof github.getOctokit>;

export interface PreviousRunResult {
  tool: RunResult["tool"];
  findings: Finding[];
  fabrication?: FabricationSnapshot | undefined;
}

export type ExactBaseRunResultLookup =
  | { status: "available"; baseSha: string; runId: number; result: RunResult }
  | { status: "unavailable"; baseSha: string; reason: HardwareImpactBaselineReason };

export interface ExactBaseRunResultInput {
  token: string;
  owner: string;
  repo: string;
  artifactName: string;
  baseSha: string;
  candidateSha: string;
  analyzedSha: string;
  currentRunId: number;
}

const fullLowercaseSha = /^[0-9a-f]{40}$/u;

export async function loadExactBaseRunResult(input: ExactBaseRunResultInput): Promise<ExactBaseRunResultLookup> {
  if (
    !fullLowercaseSha.test(input.candidateSha) ||
    !fullLowercaseSha.test(input.analyzedSha) ||
    input.candidateSha !== input.analyzedSha
  ) {
    return { status: "unavailable", baseSha: input.baseSha, reason: "candidate-mismatch" };
  }
  if (!fullLowercaseSha.test(input.baseSha)) {
    throw new Error("exact-base lookup requires a full lowercase base commit SHA");
  }
  if (!Number.isSafeInteger(input.currentRunId) || input.currentRunId <= 0) {
    throw new Error("exact-base lookup requires a valid current workflow run id");
  }

  const octokit = github.getOctokit(input.token);
  const current = await octokit.rest.actions.getWorkflowRun({
    owner: input.owner,
    repo: input.repo,
    run_id: input.currentRunId,
  });
  const workflowId = current.data.workflow_id;
  if (!Number.isSafeInteger(workflowId) || workflowId <= 0) {
    throw new Error("current workflow run did not expose a valid workflow id");
  }

  const listedRuns = await octokit.paginate(octokit.rest.actions.listWorkflowRuns, {
    owner: input.owner,
    repo: input.repo,
    workflow_id: workflowId,
    status: "completed",
    head_sha: input.baseSha,
    per_page: 100,
  });
  const eligibleRunIds = listedRuns
    .filter(
      (run) =>
        run.id !== input.currentRunId &&
        run.head_sha === input.baseSha &&
        run.workflow_id === workflowId &&
        Number.isSafeInteger(run.id),
    )
    .map((run) => run.id)
    .sort((left, right) => right - left);

  const client = new DefaultArtifactClient();
  let sawNamedArtifact = false;
  let sawUnsupportedResult = false;
  for (const workflowRunId of eligibleRunIds) {
    const findBy = {
      token: input.token,
      workflowRunId,
      repositoryOwner: input.owner,
      repositoryName: input.repo,
    };
    const artifact = (await client.listArtifacts({ latest: true, findBy })).artifacts.find(
      (entry) => entry.name === input.artifactName,
    );
    if (!artifact) continue;

    sawNamedArtifact = true;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-exact-base-"));
    try {
      const downloaded = await client.downloadArtifact(artifact.id, { path: directory, findBy });
      const parsed = await findComparisonRunResultArtifact(downloaded.downloadPath ?? directory);
      if (parsed.status === "supported") {
        return { status: "available", baseSha: input.baseSha, runId: workflowRunId, result: parsed.result };
      }
      if (parsed.status === "unsupported") sawUnsupportedResult = true;
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  if (!sawNamedArtifact) return { status: "unavailable", baseSha: input.baseSha, reason: "not-found" };
  return {
    status: "unavailable",
    baseSha: input.baseSha,
    reason: sawUnsupportedResult ? "unsupported-result" : "invalid-artifact",
  };
}

export async function loadPreviousRunResult(
  token: string,
  owner: string,
  repo: string,
  artifactName: string,
  pull: PullRequestPayload,
): Promise<PreviousRunResult | undefined> {
  const octokit = github.getOctokit(token);
  const currentSha = process.env.GITHUB_SHA;
  const currentRunId = runId(process.env.GITHUB_RUN_ID);
  const branches = [...new Set([pull.head?.ref, pull.base?.ref].filter((branch): branch is string => Boolean(branch)))];
  const client = new DefaultArtifactClient();
  for (const branch of branches) {
    for (const previousRunId of await previousRunIds(octokit, owner, repo, branch, currentSha, currentRunId)) {
      const findBy = { token, workflowRunId: previousRunId, repositoryOwner: owner, repositoryName: repo };
      const artifact = (
        await client.listArtifacts({ latest: true, findBy }).catch(() => ({ artifacts: [] }))
      ).artifacts.find((entry) => entry.name === artifactName);
      if (!artifact) {
        continue;
      }
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-previous-"));
      try {
        const downloaded = await client
          .downloadArtifact(artifact.id, { path: directory, findBy })
          .catch(() => undefined);
        const previous = await findRunResultArtifact(downloaded?.downloadPath ?? directory);
        if (previous) {
          return previous;
        }
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
  return undefined;
}

export async function findRunResultArtifact(root: string): Promise<PreviousRunResult | undefined> {
  for (const file of await artifactFiles(root)) {
    try {
      const payload = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
      if (isPreviousRunResult(payload)) {
        return payload;
      }
    } catch {}
  }
  return undefined;
}

export async function previousRunIds(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  currentSha: string | undefined,
  currentRunId: number | undefined,
): Promise<number[]> {
  const response = await octokit.rest.actions
    .listWorkflowRunsForRepo({ owner, repo, branch, status: "completed", per_page: 100 })
    .catch(() => undefined);
  return (
    response?.data.workflow_runs
      .filter((run) => run.id !== currentRunId && run.head_sha !== currentSha)
      .map((run) => run.id) ?? []
  );
}

type ComparisonArtifactParse =
  | { status: "supported"; result: RunResult }
  | { status: "unsupported" }
  | { status: "invalid" };

async function findComparisonRunResultArtifact(root: string): Promise<ComparisonArtifactParse> {
  let sawUnsupported = false;
  for (const file of await artifactFiles(root)) {
    let payload: unknown;
    try {
      payload = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    } catch {
      continue;
    }
    const classification = classifyComparisonPayload(payload);
    if (classification.status === "supported") return classification;
    if (classification.status === "unsupported") sawUnsupported = true;
  }
  return sawUnsupported ? { status: "unsupported" } : { status: "invalid" };
}

function classifyComparisonPayload(payload: unknown): ComparisonArtifactParse {
  if (!isRecord(payload)) return { status: "invalid" };
  const tool = payload.tool;
  if (!isRecord(tool) || tool.name !== "boardreadyops") return { status: "invalid" };
  return isComparisonRunResult(payload)
    ? { status: "supported", result: payload as unknown as RunResult }
    : { status: "unsupported" };
}

function isComparisonRunResult(payload: Record<string, unknown>): boolean {
  return (
    payload.schemaVersion === 1 &&
    isTool(payload.tool) &&
    typeof payload.generatedAt === "string" &&
    payload.generatedAt.length > 0 &&
    isRecord(payload.summary) &&
    Array.isArray(payload.projects) &&
    Array.isArray(payload.findings) &&
    payload.findings.every(isComparisonFinding) &&
    isFabricationSnapshot(payload.fabrication) &&
    optionalStatus(payload.status) &&
    optionalReleaseMode(payload.releaseMode) &&
    optionalReadiness(payload.readiness)
  );
}

function isTool(value: unknown): value is RunResult["tool"] {
  return (
    isRecord(value) && value.name === "boardreadyops" && typeof value.version === "string" && value.version.length > 0
  );
}

function isComparisonFinding(value: unknown): value is Finding {
  if (!isRecord(value) || !isRecord(value.resource)) return false;
  return (
    typeof value.fingerprint === "string" &&
    value.fingerprint.length > 0 &&
    typeof value.ruleId === "string" &&
    value.ruleId.length > 0 &&
    isFindingSeverity(value.severity) &&
    typeof value.message === "string" &&
    typeof value.resource.path === "string" &&
    value.resource.path.length > 0 &&
    isResourceKind(value.resource.kind)
  );
}

function isFabricationSnapshot(value: unknown): value is FabricationSnapshot {
  if (!isRecord(value) || !Array.isArray(value.bom) || !Array.isArray(value.outputs)) return false;
  return value.bom.every(isBomEntry) && value.outputs.every(isFabricationOutput);
}

function isBomEntry(value: unknown): boolean {
  if (!isRecord(value) || typeof value.reference !== "string" || value.reference.length === 0) return false;
  const optionalStrings = ["sourcePath", "value", "footprint", "manufacturer", "mpn", "lifecycle", "compliance"];
  if (optionalStrings.some((key) => value[key] !== undefined && typeof value[key] !== "string")) return false;
  if (
    value.suppliers !== undefined &&
    (!Array.isArray(value.suppliers) || !value.suppliers.every((item) => typeof item === "string"))
  ) {
    return false;
  }
  if (value.dnp !== undefined && typeof value.dnp !== "boolean") return false;
  return value.quantity === undefined || (typeof value.quantity === "number" && Number.isFinite(value.quantity));
}

function isFabricationOutput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    value.kind.length > 0 &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        isRecord(file) && typeof file.path === "string" && file.path.length > 0 && typeof file.digest === "string",
    )
  );
}

function optionalReadiness(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    value.score <= 100 &&
    (value.status === "ready" || value.status === "at-risk" || value.status === "blocked")
  );
}

function optionalStatus(value: unknown): boolean {
  return value === undefined || value === "passed" || value === "failed";
}

function optionalReleaseMode(value: unknown): boolean {
  return value === undefined || value === "prototype" || value === "pilot" || value === "production";
}

function isFindingSeverity(value: unknown): boolean {
  return value === "critical" || value === "high" || value === "medium" || value === "low" || value === "info";
}

function isResourceKind(value: unknown): boolean {
  return (
    value === "project" ||
    value === "schematic" ||
    value === "pcb" ||
    value === "bom" ||
    value === "pinmap" ||
    value === "firmware" ||
    value === "manifest"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function artifactFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function runId(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isPreviousRunResult(payload: unknown): payload is PreviousRunResult {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Partial<RunResult>;
  return candidate.tool?.name === "boardreadyops" && Array.isArray(candidate.findings);
}
