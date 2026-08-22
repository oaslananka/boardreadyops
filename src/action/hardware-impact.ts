import { readFile, stat } from "node:fs/promises";
import path from "node:path";
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

async function checkoutSha(workspace: string): Promise<string> {
  const gitDirectory = await resolveGitDirectory(workspace);
  const head = (await readFile(path.join(gitDirectory, "HEAD"), "utf8")).trim();
  if (fullLowercaseSha.test(head)) return head;

  const match = /^ref: (refs\/[^\r\n]+)$/u.exec(head);
  const ref = match?.[1];
  if (!ref || !safeGitRef(ref)) {
    throw new Error("analyzed checkout did not resolve to a full lowercase commit SHA");
  }

  const commonDirectory = await resolveCommonGitDirectory(gitDirectory);
  const looseSha = await readOptionalText(path.join(commonDirectory, ...ref.split("/")));
  if (looseSha && fullLowercaseSha.test(looseSha.trim())) return looseSha.trim();

  const packedRefs = await readOptionalText(path.join(commonDirectory, "packed-refs"));
  if (packedRefs) {
    for (const line of packedRefs.split(/\r?\n/u)) {
      if (line.startsWith("#") || line.startsWith("^") || line.length === 0) continue;
      const separator = line.indexOf(" ");
      if (separator < 0 || line.slice(separator + 1) !== ref) continue;
      const sha = line.slice(0, separator);
      if (fullLowercaseSha.test(sha)) return sha;
    }
  }

  throw new Error("analyzed checkout did not resolve to a full lowercase commit SHA");
}

async function resolveGitDirectory(workspace: string): Promise<string> {
  const dotGit = path.join(workspace, ".git");
  const metadata = await stat(dotGit);
  if (metadata.isDirectory()) return dotGit;
  if (!metadata.isFile()) throw new Error("workspace .git metadata is unavailable");

  const marker = (await readFile(dotGit, "utf8")).trim();
  const match = /^gitdir: (.+)$/u.exec(marker);
  if (!match?.[1]) throw new Error("workspace .git metadata is invalid");
  return path.resolve(path.dirname(dotGit), match[1]);
}

async function resolveCommonGitDirectory(gitDirectory: string): Promise<string> {
  const commonMarker = await readOptionalText(path.join(gitDirectory, "commondir"));
  return commonMarker ? path.resolve(gitDirectory, commonMarker.trim()) : gitDirectory;
}

async function readOptionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function safeGitRef(ref: string): boolean {
  if (!ref.startsWith("refs/") || ref.includes("\\")) return false;
  return ref.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function numericRunId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
