import { execFileSync } from "node:child_process";
import { resolveGitExecutable } from "../util/git-resolver.js";
import { diffVerifiedPcbFootprints, type VerifiedFootprintDiffResult } from "./footprint-diff.js";

const MAX_PCB_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = MAX_PCB_SOURCE_BYTES + 1024;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BLOB_SHA = COMMIT_SHA;

function hasControl(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export type GitPcbEvidenceResult =
  | {
      status: "complete";
      sourcePath: string;
      baseCommitSha: string;
      headCommitSha: string;
      baseBlobSha: string;
      headBlobSha: string;
      facts: Extract<VerifiedFootprintDiffResult, { status: "complete" }>;
      /** Source changes do not themselves establish risk, DRC, or release impact. */
      riskAssessment: "not-evaluated";
    }
  | {
      status: "unavailable";
      reason:
        | "invalid-source-path"
        | "unresolved-commit"
        | "base-source-missing"
        | "head-source-missing"
        | "source-too-large"
        | "unreadable-source";
    }
  | {
      status: "unavailable";
      side: "base" | "head";
      reason: Extract<VerifiedFootprintDiffResult, { status: "unavailable" }>["reason"];
    };

export interface GitPcbEvidenceOptions {
  repositoryRoot: string;
  sourcePath: string;
  baseRef: string;
  headRef: string;
}

/**
 * Select exactly one repository-relative KiCad PCB file, never a git revision,
 * option, glob, absolute path, traversal, or Git-internal metadata path.
 */
function validSourcePath(value: string): boolean {
  if (!value || value.length > 1024 || value.startsWith("/") || !value.endsWith(".kicad_pcb")) return false;
  if (value.includes("\\") || value.includes(":") || hasControl(value)) return false;
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && segment !== ".git");
}

function git(root: string, args: string[], maxBuffer = 4096): string {
  return execFileSync(resolveGitExecutable(), ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
    maxBuffer,
  });
}

function commit(root: string, ref: string): string | undefined {
  if (!ref || ref.length > 255 || ref.startsWith("-") || hasControl(ref)) return undefined;
  try {
    const resolved = git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
    return COMMIT_SHA.test(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function sourceAtCommit(
  root: string,
  sha: string,
  file: string,
):
  | { status: "complete"; blobSha: string; text: string }
  | { status: "unavailable"; reason: "missing" | "too-large" | "unreadable" } {
  let blobSha: string;
  try {
    blobSha = git(root, ["rev-parse", "--verify", "--end-of-options", `${sha}:${file}`]).trim();
  } catch {
    return { status: "unavailable", reason: "missing" };
  }
  if (!BLOB_SHA.test(blobSha)) return { status: "unavailable", reason: "unreadable" };
  try {
    const type = git(root, ["cat-file", "-t", blobSha]).trim();
    if (type !== "blob") return { status: "unavailable", reason: "unreadable" };
    const size = Number(git(root, ["cat-file", "-s", blobSha]).trim());
    if (!Number.isSafeInteger(size) || size < 0) return { status: "unavailable", reason: "unreadable" };
    if (size > MAX_PCB_SOURCE_BYTES) return { status: "unavailable", reason: "too-large" };
    const text = git(root, ["cat-file", "blob", blobSha], MAX_GIT_OUTPUT_BYTES);
    if (Buffer.byteLength(text, "utf8") !== size) return { status: "unavailable", reason: "unreadable" };
    return { status: "complete", blobSha, text };
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }
}

/**
 * Compute local-only PCB footprint facts from immutable, resolved Git objects.
 * No working-tree reads, network operations, publication or inferred risk score.
 * Do not publish this result without an independently authorized evidence contract.
 */
export function gitPcbFootprintEvidence(options: GitPcbEvidenceOptions): GitPcbEvidenceResult {
  if (!validSourcePath(options.sourcePath)) return { status: "unavailable", reason: "invalid-source-path" };
  const base = commit(options.repositoryRoot, options.baseRef);
  const head = commit(options.repositoryRoot, options.headRef);
  if (!base || !head) return { status: "unavailable", reason: "unresolved-commit" };

  const baseSource = sourceAtCommit(options.repositoryRoot, base, options.sourcePath);
  if (baseSource.status !== "complete") {
    return {
      status: "unavailable",
      reason:
        baseSource.reason === "too-large"
          ? "source-too-large"
          : baseSource.reason === "missing"
            ? "base-source-missing"
            : "unreadable-source",
    };
  }
  const headSource = sourceAtCommit(options.repositoryRoot, head, options.sourcePath);
  if (headSource.status !== "complete") {
    return {
      status: "unavailable",
      reason:
        headSource.reason === "too-large"
          ? "source-too-large"
          : headSource.reason === "missing"
            ? "head-source-missing"
            : "unreadable-source",
    };
  }
  const facts = diffVerifiedPcbFootprints(baseSource.text, headSource.text);
  if (facts.status !== "complete") return facts;

  return {
    status: "complete",
    sourcePath: options.sourcePath,
    baseCommitSha: base,
    headCommitSha: head,
    baseBlobSha: baseSource.blobSha,
    headBlobSha: headSource.blobSha,
    facts,
    riskAssessment: "not-evaluated",
  };
}
