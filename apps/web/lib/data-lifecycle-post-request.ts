import type { output, ZodType } from "zod";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "./bounded-request-body.js";
import { resolveCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import { resolveSettingsTenantScope } from "./settings-tenant.js";
import { viewerAuthorization } from "./viewer-authorization.js";

const maximumLifecycleBodyBytes = 16 * 1024;

type PreparedLifecyclePost<T extends ZodType> =
  | { ok: true; actorLogin: string; tenantId: string; data: output<T>; databaseUrl: string }
  | { ok: false; response: Response };

/** Shared authentication, bounded parse errors and persistence prerequisites for lifecycle intake routes. */
export async function prepareLifecyclePost<T extends ZodType>(
  request: Request,
  schema: T,
): Promise<PreparedLifecyclePost<T>> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "authentication required" },
        { status: 401, headers: { "cache-control": "private, no-store" } },
      ),
    };
  }
  let body: unknown = {};
  try {
    const text = (await readBoundedRequestBody(request, maximumLifecycleBodyBytes)).toString("utf8");
    if (text) body = JSON.parse(text) as unknown;
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: tooLarge ? "Request payload too large" : "Invalid JSON" },
        { status: tooLarge ? 413 : 400, headers: { "cache-control": "private, no-store" } },
      ),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Invalid payload", issues: parsed.error.issues },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      ),
    };
  }
  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Database not configured" },
        { status: 503, headers: { "cache-control": "private, no-store" } },
      ),
    };
  }
  // The tenant belongs to the authorized GitHub App installation, not to the
  // human operator's personal GitHub login.
  const selected = (
    await resolveSettingsTenantScope(viewer.session, (parsed.data as { installationId?: string }).installationId)
  ).selected;
  const tenantLogin = selected?.accountLogin.trim();
  if (!tenantLogin || tenantLogin.startsWith("Installation #")) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "installation access denied" },
        { status: 403, headers: { "cache-control": "private, no-store" } },
      ),
    };
  }
  return {
    ok: true,
    actorLogin: viewer.session.login,
    tenantId: tenantLogin,
    data: parsed.data,
    databaseUrl: config.databaseUrl,
  };
}
