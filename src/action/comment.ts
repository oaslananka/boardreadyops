import * as github from "@actions/github";
import { diffFabrication } from "../core/diff/fabrication.js";
import type { RunResult } from "../core/result.js";
import { formatMarkdown, stickyMarker } from "../report/markdown.js";
import { formatReviewComment, type ReviewReportLink } from "../report/review-comment.js";
import { loadPreviousRunResult } from "./previous-result.js";

export async function upsertPullRequestComment(
  result: RunResult,
  artifactName: string,
  format: "report" | "review" = "report",
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const pull = github.context.payload.pull_request;
  if (!token || !repository || !pull) {
    return "";
  }
  const baseRepo = pull.base?.repo?.full_name;
  const headRepo = pull.head?.repo?.full_name;
  if (!baseRepo || !headRepo || baseRepo !== repository || headRepo !== baseRepo) {
    return "";
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return "";
  }
  const octokit = github.getOctokit(token);
  let body: string;
  if (format === "review") {
    body = formatReviewComment(result, reviewReports(artifactName));
  } else {
    const legacyDiff = result.hardwareImpact
      ? undefined
      : await fabricationDiff(token, owner, repo, artifactName, pull, result);
    body = formatMarkdown(result, [], legacyDiff);
  }
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pull.number,
  });
  const existing = comments.find((comment) => comment.body?.includes(stickyMarker));
  if (existing) {
    const updated = await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return updated.data.html_url ?? "";
  }
  const created = await octokit.rest.issues.createComment({ owner, repo, issue_number: pull.number, body });
  return created.data.html_url ?? "";
}

async function fabricationDiff(
  token: string,
  owner: string,
  repo: string,
  artifactName: string,
  pull: NonNullable<typeof github.context.payload.pull_request>,
  result: RunResult,
) {
  const previous = await loadPreviousRunResult(token, owner, repo, artifactName, pull);
  return previous?.fabrication
    ? diffFabrication(previous.fabrication, result.fabrication, previous.findings, result.findings)
    : undefined;
}

function reviewReports(artifactName: string): ReviewReportLink[] {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (server && repository && runId) {
    return [{ label: `Reports (artifact: ${artifactName})`, url: `${server}/${repository}/actions/runs/${runId}` }];
  }
  return [];
}
