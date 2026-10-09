#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";

const CODEQL_APP = "github-advanced-security";

export function nativeCodeqlDecision(checkRuns, headSha) {
  if (!Array.isArray(checkRuns)) throw new Error("GitHub check-run response is invalid");
  const native = checkRuns
    .filter((check) => check.name === "CodeQL" && check.app?.slug === CODEQL_APP && check.head_sha === headSha)
    .sort((a, b) => b.id - a.id)[0];
  if (native?.status !== "completed") return { state: "pending" };
  return native.conclusion === "success"
    ? { state: "success" }
    : { state: "failure", conclusion: native.conclusion ?? "missing", url: native.html_url };
}

export async function waitForNativeCodeql(readChecks, headSha, options = {}) {
  const attempts = options.attempts ?? 24;
  const pause = options.pause ?? (() => sleep(5_000));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const decision = nativeCodeqlDecision(await readChecks(), headSha);
    if (decision.state === "success") return;
    if (decision.state === "failure") {
      throw new Error(`Native CodeQL PR security check failed (${decision.conclusion}): ${decision.url ?? "no URL"}`);
    }
    if (attempt + 1 < attempts) await pause();
  }
  throw new Error("Native CodeQL PR security check missing or incomplete after bounded polling");
}

export async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const headSha = process.env.CODEQL_PR_HEAD_SHA;
  const token = process.env.GH_TOKEN;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) throw new Error("Invalid GitHub repository identity");
  if (!headSha || !/^[0-9a-f]{40}$/u.test(headSha)) throw new Error("Invalid pull request head SHA");
  if (!token) throw new Error("Read-only GitHub token is missing");
  const endpoint = `https://api.github.com/repos/${repo}/commits/${headSha}/check-runs?check_name=CodeQL&per_page=100`;
  const readChecks = async () => {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Unable to read native CodeQL PR check: HTTP ${response.status}`);
    return (await response.json()).check_runs;
  };
  await waitForNativeCodeql(readChecks, headSha);
  process.stdout.write("Native CodeQL PR alert check passed on the exact head SHA\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
