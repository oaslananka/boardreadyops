import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import {
  configuredGitHubActionsWorkflow,
  githubActionsWorkflowGitRef,
  githubActionsWorkflowRef,
} from "./github-actions-workflow.js";

export type ResultOidcExpectations = {
  runId: string;
  executionAttemptId?: string;
  repository: string;
  repositoryId: string;
  workflowRef: string;
  ref: string;
};

type QueryRow = Record<string, unknown>;

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function stringCell(row: QueryRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

export async function resultOidcExpectations(
  executor: SqlQueryExecutor,
  runId: string,
  executionAttemptId: string | undefined,
): Promise<ResultOidcExpectations | undefined> {
  const workflow = configuredGitHubActionsWorkflow();
  if (!workflow) return undefined;

  const result = await executor.query(
    `select repositories.owner, repositories.name, repositories.github_repo_id, repositories.default_branch
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
  if (!owner || !name || !repositoryId || !defaultBranch) return undefined;

  const repository = `${owner}/${name}`;
  const workflowRef = githubActionsWorkflowRef(repository, defaultBranch, workflow);
  const ref = githubActionsWorkflowGitRef(defaultBranch);
  if (!workflowRef || !ref) return undefined;

  return {
    runId,
    ...(executionAttemptId === undefined ? {} : { executionAttemptId }),
    repository,
    repositoryId,
    workflowRef,
    ref,
  };
}
