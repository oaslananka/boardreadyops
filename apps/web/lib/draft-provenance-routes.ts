import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import type { DraftProvenanceResult, verifyStoredManufacturingDraftClaim } from "./manufacturing-draft-provenance.js";

// Read-only, owner-only statement of current runner-origin evidence.
// Never grants manufacturing approval or exposes a signed receipt or ZIP.
type Viewer = {
  session: object | undefined;
  authorizeInstallation(installationId: string): Promise<boolean>;
};
type QueryExecutor = SqlQueryExecutor & { close(): Promise<void> };

export type DraftProvenanceRouteDependencies = {
  authorize(): Promise<Viewer>;
  openExecutor(): QueryExecutor | undefined;
  verify: typeof verifyStoredManufacturingDraftClaim;
  environment: Readonly<Record<string, string | undefined>>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function response(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", vary: "Cookie" },
  });
}

type SourceRow = { installation_id?: unknown; execution_attempt_id?: unknown };
function records(value: unknown): SourceRow[] {
  if (!value || typeof value !== "object" || !("rows" in value)) return [];
  const rows = (value as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

export async function handleDraftProvenanceStatus(
  runId: string,
  dependencies: DraftProvenanceRouteDependencies,
): Promise<Response> {
  const viewer = await dependencies.authorize();
  if (!viewer.session) return response({ ok: false, error: "Authentication required" }, 401);
  if (!uuid.test(runId)) return response({ ok: false, error: "Invalid run identifier" }, 400);

  const executor = dependencies.openExecutor();
  if (!executor) return response({ ok: false, error: "Run store is unavailable" }, 503);
  try {
    // Source ownership is authoritative; no caller-supplied repository ID.
    const sourceQuery =
      "select repositories.installation_id, release_runs.execution_attempt_id " +
      "from release_runs join repositories on repositories.id = release_runs.repository_id " +
      "where release_runs.id = $1 and repositories.disabled_at is null limit 1";
    const found = await executor.query(sourceQuery, [runId]);
    const row = records(found)[0];
    const installationId = row?.installation_id;
    if (typeof installationId !== "string" || !uuid.test(installationId)) {
      return response({ ok: false, error: "Run not found" }, 404);
    }
    if (!(await viewer.authorizeInstallation(installationId))) {
      return response({ ok: false, error: "Run not found" }, 404);
    }
    let status: DraftProvenanceResult["status"] = "unverified";
    const attempt = row?.execution_attempt_id;
    if (typeof attempt === "string" && uuid.test(attempt)) {
      const result = await dependencies.verify({
        executor,
        runId,
        executionAttemptId: attempt,
        storageRoot: dependencies.environment.ARTIFACT_STORAGE_ROOT ?? "",
        storageDriver: dependencies.environment.ARTIFACT_STORAGE_DRIVER ?? "local",
      });
      status = result.status;
    }
    // The receipt/ZIP read may outlive the viewer's permission or the run's
    // original ownership/attempt. Refresh both before disclosing even a
    // read-only status. This narrows the race but is not a sharing grant.
    const latest = records(await executor.query(sourceQuery, [runId]))[0];
    if (latest?.installation_id !== installationId || latest.execution_attempt_id !== attempt) {
      return response({ ok: false, error: "Run not found" }, 404);
    }
    if (!(await viewer.authorizeInstallation(installationId))) {
      return response({ ok: false, error: "Run not found" }, 404);
    }
    return response({ ok: true, status, manufacturingApproved: false }, 200);
  } catch {
    return response({ ok: false, error: "Run status is unavailable" }, 503);
  } finally {
    await executor.close();
  }
}
