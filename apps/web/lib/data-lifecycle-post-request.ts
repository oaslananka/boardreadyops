import type { output, ZodType } from "zod";
import { resolveCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import { viewerAuthorization } from "./viewer-authorization.js";

type PreparedLifecyclePost<T extends ZodType> =
  | { ok: true; actorLogin: string; data: output<T>; databaseUrl: string }
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
    const text = await request.text();
    if (text) body = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400, headers: { "cache-control": "private, no-store" } },
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
  return { ok: true, actorLogin: viewer.session.login, data: parsed.data, databaseUrl: config.databaseUrl };
}
