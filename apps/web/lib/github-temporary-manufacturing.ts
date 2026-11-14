import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createAppAuth } from "@octokit/auth-app";
import type { ResultOidcExpectations } from "./result-oidc-expectations.js";

const temporaryManufacturingRetentionDays = 3;
const githubIdPattern = /^[1-9]\d{0,19}$/u;
const githubStoragePath = /^github-actions\/([1-9]\d{0,19})\/([1-9]\d{0,19})$/u;
const safeRepository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function temporaryManufacturingStoragePath(runId: string, artifactId: string): string | undefined {
  return githubIdPattern.test(runId) && githubIdPattern.test(artifactId)
    ? `github-actions/${runId}/${artifactId}`
    : undefined;
}

export function temporaryManufacturingArtifactReference(storagePath: string):
  | {
      runId: string;
      artifactId: string;
    }
  | undefined {
  const match = githubStoragePath.exec(storagePath);
  return match?.[1] && match[2] ? { runId: match[1], artifactId: match[2] } : undefined;
}

export function temporaryManufacturingExpiresAt(uploadedAt: string): string | undefined {
  const millis = Date.parse(uploadedAt);
  return Number.isFinite(millis)
    ? new Date(millis + temporaryManufacturingRetentionDays * 24 * 60 * 60 * 1000).toISOString()
    : undefined;
}

export function temporaryManufacturingDownloadUrl(repository: string, storagePath: string): string | undefined {
  if (!safeRepository.test(repository)) return undefined;
  const reference = temporaryManufacturingArtifactReference(storagePath);
  if (!reference) return undefined;
  const [owner, name] = repository.split("/");
  if (!owner || !name || owner === "." || owner === ".." || name === "." || name === "..") {
    return undefined;
  }
  return (
    "https://github.com/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(name) +
    "/actions/runs/" +
    reference.runId +
    "/artifacts/" +
    reference.artifactId
  );
}

export function matchesTemporaryManufacturingArtifact(
  value: unknown,
  expected: Pick<ResultOidcExpectations, "runId" | "executionAttemptId" | "githubRunId" | "repositoryId">,
  artifactId: string,
  now: number,
): boolean {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Record<string, unknown>;
  const workflow = artifact.workflow_run;
  if (!workflow || typeof workflow !== "object") return false;
  const workflowRun = workflow as Record<string, unknown>;
  const expires = Date.parse(String(artifact.expires_at ?? ""));
  return (
    String(artifact.id) === artifactId &&
    artifact.name === ["boardreadyops-manufacturing", expected.runId, expected.executionAttemptId].join("-") &&
    artifact.expired === false &&
    Number.isFinite(expires) &&
    expires > now &&
    String(workflowRun.id) === expected.githubRunId &&
    String(workflowRun.repository_id) === expected.repositoryId
  );
}

export type TemporaryManufacturingArtifactVerifier = (
  executor: SqlQueryExecutor,
  expected: ResultOidcExpectations,
  artifactId: string,
) => Promise<boolean>;

/** Require a real artifact belonging to the authenticated GitHub workflow run. */
export function createTemporaryManufacturingArtifactVerifier(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): TemporaryManufacturingArtifactVerifier {
  return async (executor, expected, artifactId) => {
    if (
      !githubIdPattern.test(artifactId) ||
      !temporaryManufacturingDownloadUrl(
        expected.repository,
        temporaryManufacturingStoragePath(expected.githubRunId, artifactId) ?? "",
      )
    )
      return false;
    const appId = environment.GITHUB_APP_ID?.trim();
    const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
    if (!appId || !privateKey) return false;

    const installation = await executor.query(
      "select installation.github_installation_id from installations as installation " +
        "join repositories as repository on repository.installation_id = installation.id " +
        "where installation.id = $1 and repository.id = $2",
      [expected.installationId, expected.repositoryRecordId],
    );
    const rows =
      typeof installation === "object" &&
      installation !== null &&
      "rows" in installation &&
      Array.isArray(installation.rows)
        ? installation.rows
        : [];
    const row = rows[0] as Record<string, unknown> | undefined;
    const installationId = Number(row?.github_installation_id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) return false;

    const auth = createAppAuth({ appId, privateKey, installationId });
    const token = (await auth({ type: "installation" })).token;
    if (!token) return false;
    const response = await fetcher(
      `https://api.github.com/repos/${expected.repository}/actions/artifacts/${artifactId}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2026-03-10",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return false;
    const value: unknown = await response.json();
    return matchesTemporaryManufacturingArtifact(value, expected, artifactId, Date.now());
  };
}
