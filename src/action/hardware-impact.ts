import { execFile } from "node:child_process";
import * as github from "@actions/github";
import { buildHardwareImpact, type HardwareImpactV1 } from "../core/diff/hardware-impact.js";
import type { RunResult } from "../core/result.js";
import { loadExactBaseRunResult } from "./previous-result.js";

const readinessCheckName = "BoardReadyOps / release readiness";
const fullLowercaseSha = /^[0-9a-f]{40}$/u;
const baseMarker = /^Impact base SHA: ([0-9a-f]{40})$/gmu;

export interface BuildActionHardwareImpactContext {
  workspace: string;
  artifactName?: string | undefined;
}

type PullRequestBinding = { baseSha: string; headSha: string };

export async function buildActionHardwareImpact(
  result: RunResult,
  context: BuildActionHardwareImpactContext,
): Promise<HardwareImpactV1 | undefined> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const currentRunId = numericRunId(process.env.GITHUB_RUN_ID);
  if (!token || !repository || currentRunId === undefined) return undefined;

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) return undefined;

  const binding = directPullRequestBinding(repository) ?? (await hostedPullRequestBinding(token, owner, repo));
  if (!binding) return undefined;

  const analyzedSha = await checkoutSha(context.workspace);
  const lookup = await loadExactBaseRunResult({
    token,
    owner,
    repo,
    artifactName: context.artifactName ?? "boardreadyops",
    baseSha: binding.baseSha,
    candidateSha: binding.headSha,
    analyzedSha,
    currentRunId,
  });

  return lookup.status === "available"
    ? buildHardwareImpact({
        baseline: { status: "available", sha: lookup.baseSha, result: lookup.result },
        candidate: { sha: binding.headSha, result },
      })
    : buildHardwareImpact({
        baseline: { status: "unavailable", sha: lookup.baseSha, reason: lookup.reason },
        candidate: { sha: binding.headSha, result },
      });
}

function directPullRequestBinding(repository: string): PullRequestBinding | undefined {
  const pull = github.context.payload.pull_request;
  const baseSha = pull?.base?.sha;
  const headSha = pull?.head?.sha;
  const baseRepository = pull?.base?.repo?.full_name;
  const headRepository = pull?.head?.repo?.full_name;
  if (
    typeof baseSha !== "string" ||
    typeof headSha !== "string" ||
    !fullLowercaseSha.test(baseSha) ||
    !fullLowercaseSha.test(headSha) ||
    baseRepository !== repository ||
    headRepository !== repository
  ) {
    return undefined;
  }
  return { baseSha, headSha };
}

async function hostedPullRequestBinding(
  token: string,
  owner: string,
  repo: string,
): Promise<PullRequestBinding | undefined> {
  const headSha = process.env.BOARDREADYOPS_PR_HEAD_SHA;
  const cloudRunId = process.env.BOARDREADYOPS_CLOUD_RUN_ID;
  if (!headSha || !fullLowercaseSha.test(headSha) || !cloudRunId) return undefined;

  const octokit = github.getOctokit(token);
  const checks = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref: headSha,
    check_name: readinessCheckName,
    filter: "all",
    per_page: 100,
  });
  const matchingChecks = checks.filter(
    (check) => check.name === readinessCheckName && check.external_id === cloudRunId && check.head_sha === headSha,
  );
  if (matchingChecks.length !== 1) return undefined;

  const summary = matchingChecks[0]?.output?.summary;
  if (typeof summary !== "string") return undefined;
  const matches = [...summary.matchAll(baseMarker)];
  if (matches.length !== 1) return undefined;
  const baseSha = matches[0]?.[1];
  return baseSha && fullLowercaseSha.test(baseSha) ? { baseSha, headSha } : undefined;
}

function checkoutSha(workspace: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const sha = String(stdout).trim();
      if (!fullLowercaseSha.test(sha)) {
        reject(new Error("analyzed checkout did not resolve to a full lowercase commit SHA"));
        return;
      }
      resolve(sha);
    });
  });
}

function numericRunId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
