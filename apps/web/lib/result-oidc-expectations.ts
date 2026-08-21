import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import {
  configuredGitHubActionsWorkflow,
  githubActionsWorkflowGitRef,
  githubActionsWorkflowRef,
} from "./github-actions-workflow.js";

type ResultTrustMode = "safe" | "standard";
type ResultSafeModeReason = "draft-pull-request" | "fork-pull-request" | "private-repository";

export type ResultOidcExpectations = {
  runId: string;
  executionAttemptId?: string;
  repository: string;
  repositoryId: string;
  targetSha: string;
  workflowRef: string;
  ref: string;
  audience: string;
  trustMode: ResultTrustMode;
  safeModeReasons: ResultSafeModeReason[];
};

type QueryRow = Record<string, unknown>;

const safeModeReasonOrder = ["draft-pull-request", "fork-pull-request", "private-repository"] as const;
const exactCommitShaPattern = /^[0-9a-f]{40}$/u;
const safeModeReasonSet = new Set<string>(safeModeReasonOrder);

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function stringCell(row: QueryRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function trustSnapshot(row: QueryRow): Pick<ResultOidcExpectations, "safeModeReasons" | "trustMode"> | undefined {
  const trustMode = stringCell(row, "trust_mode");
  const rawReasons = row.safe_mode_reasons;
  if ((trustMode !== "standard" && trustMode !== "safe") || !Array.isArray(rawReasons)) return undefined;
  if (rawReasons.some((reason) => typeof reason !== "string" || !safeModeReasonSet.has(reason))) return undefined;

  const uniqueReasons = new Set(rawReasons as string[]);
  if (uniqueReasons.size !== rawReasons.length) return undefined;
  const safeModeReasons = safeModeReasonOrder.filter((reason) => uniqueReasons.has(reason));
  if (
    safeModeReasons.length !== rawReasons.length ||
    safeModeReasons.some((reason, index) => reason !== rawReasons[index]) ||
    (trustMode === "standard" && safeModeReasons.length !== 0) ||
    (trustMode === "safe" && safeModeReasons.length === 0)
  ) {
    return undefined;
  }
  return { trustMode, safeModeReasons };
}

export async function resultOidcExpectations(
  executor: SqlQueryExecutor,
  runId: string,
  executionAttemptId: string | undefined,
): Promise<ResultOidcExpectations | undefined> {
  const workflow = configuredGitHubActionsWorkflow();
  if (!workflow) return undefined;

  const result = await executor.query(
    `select repositories.owner,
            repositories.name,
            repositories.github_repo_id,
            repositories.default_branch,
            release_runs.commit_sha,
            release_runs.trust_mode,
            release_runs.safe_mode_reasons
     from release_runs
     join repositories on repositories.id = release_runs.repository_id
     join release_run_attempts
       on release_run_attempts.id = release_runs.execution_attempt_id
      and release_run_attempts.run_id = release_runs.id
     where release_runs.id = $1
       and release_runs.execution_attempt_id is not distinct from $2
       and release_run_attempts.github_workflow_dispatch_id is not null
     limit 1`,
    [runId, executionAttemptId ?? null],
  );
  const row = rows(result)[0];
  if (!row) return undefined;

  const owner = stringCell(row, "owner");
  const name = stringCell(row, "name");
  const repositoryId = stringCell(row, "github_repo_id");
  const defaultBranch = stringCell(row, "default_branch");
  const sha = stringCell(row, "commit_sha");
  const trust = trustSnapshot(row);
  if (!owner || !name || !repositoryId || !defaultBranch || !sha || !exactCommitShaPattern.test(sha) || !trust) {
    return undefined;
  }

  const repository = `${owner}/${name}`;
  const workflowRef = githubActionsWorkflowRef(repository, defaultBranch, workflow);
  const ref = githubActionsWorkflowGitRef(defaultBranch);
  if (!workflowRef || !ref) return undefined;
  const audience = `boardreadyops-cloud:${runId}:${executionAttemptId ?? "none"}:${sha}:${trust.trustMode}:${
    trust.safeModeReasons.length > 0 ? trust.safeModeReasons.join(",") : "none"
  }`;

  return {
    runId,
    ...(executionAttemptId === undefined ? {} : { executionAttemptId }),
    repository,
    repositoryId,
    targetSha: sha,
    workflowRef,
    ref,
    audience,
    ...trust,
  };
}
