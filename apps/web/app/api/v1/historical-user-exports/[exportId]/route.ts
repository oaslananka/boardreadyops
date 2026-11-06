import { DataLifecycleStore } from "@boardreadyops/db";
import { isHistoricalUserUuid } from "@boardreadyops/db/data-export-historical-uuid";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { optionalCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox",
} as const;

function denied(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: responseHeaders });
}

/**
 * Read-only recovery *status* after a GitHub user removes the App.
 *
 * Authentication is the signed GitHub OAuth browser session; its immutable
 * numeric user ID is authoritative, not the mutable login or any installation
 * formerly present in the session. Historical exports can NEVER be retrieved
 * through the normal installation-bound route, and this route never delivers
 * bytes, a signed URL, or a capability to delete data.
 */
export async function GET(request: Request, context: { params: Promise<{ exportId: string }> }): Promise<Response> {
  const viewer = await viewerAuthorization();
  const identity = viewer.session?.userId;
  if (!Number.isSafeInteger(identity) || (identity ?? 0) <= 0) return denied(401, "authentication required");

  const url = new URL(request.url);
  if (url.search !== "" || request.headers.has("range")) return denied(400, "invalid historical status request");
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site")
    return denied(403, "origin denied");

  const { exportId } = await context.params;
  if (!isHistoricalUserUuid(exportId)) return denied(404, "not found");

  const config = optionalCloudPersistenceConfiguration();
  if (config?.mode !== "postgres") return denied(503, "Database not configured");

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const exportStatus = await new DataLifecycleStore(executor).getVerifiedHistoricalUserExport({
      exportId,
      verifiedGitHubUserId: identity as number,
    });
    if (!exportStatus) return denied(404, "not found");

    // No tenant/login, scope_id, original owner ID, stored download URL or
    // installation details in this bounded response.
    return Response.json(
      {
        ok: true,
        export: {
          id: exportStatus.id,
          scope: "user",
          status: exportStatus.status,
          createdAt: exportStatus.createdAt,
          expiresAt: exportStatus.expiresAt,
          downloadAvailable: false,
        },
      },
      { headers: responseHeaders },
    );
  } catch {
    return denied(503, "Recovery status temporarily unavailable");
  } finally {
    await executor.close();
  }
}
