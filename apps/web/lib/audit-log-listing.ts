import type { AuditEventExportItem } from "@boardreadyops/db/audit-log-store";
import { notCancelledSubscription } from "./tenant-scope.js";
import type { UserSession } from "./user-session.js";

/**
 * The audit trail a tenant can read about their own installations.
 *
 * `audit_events` has existed since migration 0004 and is written on every consequential action,
 * but the only way to read it was `/api/v1/operator/installations/:id/audit-events`, which
 * authenticates a control-plane operator rather than a customer. So the record a customer needs
 * during an incident -- who approved this, when did this repository stop being scanned, which
 * runner claimed that job -- existed and was unreachable by the person it is about.
 *
 * Two things are deliberately reused rather than rewritten. The store's metadata allowlist,
 * because it is what keeps a token or a bearer header from reaching a page through an event's
 * `metadata` column; and its keyset scan, because `audit_events` is append-only and unbounded,
 * so offset pagination would degrade exactly as a tenant's history grows.
 */

export type AuditLogEntry = AuditEventExportItem;

export type AuditLogCursor = { createdAt: string; id: string };

export type AuditLogResult =
  | { state: "signed-out" }
  | { state: "not-configured" }
  | { state: "ok"; events: readonly AuditLogEntry[]; next: string | undefined };

const defaultPageSize = 25;
/** Held below the store's own ceiling of 100 so `limit + 1` can always be asked for. */
const maxPageSize = 50;
const maxCursorIdLength = 128;

/** Matches the `audit_events_event_type_valid` check constraint in migration 0004. */
const eventTypePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

export function encodeAuditLogCursor(cursor: AuditLogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Returns `undefined` for a missing, malformed, or oversized cursor rather than throwing.
 *
 * The cursor carries no authority: it only resumes a scan inside a query already restricted to
 * the viewer's own installation ids, so a hand-built one cannot reach another tenant's events.
 */
export function decodeAuditLogCursor(value: string | null | undefined): AuditLogCursor | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt))) return undefined;
  if (typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.id.length > maxCursorIdLength) {
    return undefined;
  }
  return { createdAt: candidate.createdAt, id: candidate.id };
}

/** Clamps an untrusted requested page size to `[1, maxPageSize]`, defaulting when absent or invalid. */
export function normalizedAuditLogLimit(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value)) return defaultPageSize;
  return Math.min(Math.max(value, 1), maxPageSize);
}

/** Drops an event-type filter the column could not hold anyway, instead of erroring on it. */
export function normalizedEventType(value: string | undefined): string | undefined {
  if (!value || value.length > 160 || !eventTypePattern.test(value)) return undefined;
  return value;
}

const installationsQuery = `
  select installations.id
    from installations
   where installations.github_installation_id = any($1::bigint[])
     and installations.suspended_at is null
     and ${notCancelledSubscription}`;

export async function loadAuditLog(
  session: UserSession | undefined,
  options: { cursor?: AuditLogCursor; limit?: number; eventType?: string; repositoryId?: string } = {},
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AuditLogResult> {
  if (!session) return { state: "signed-out" };
  if (session.installationIds.length === 0) return { state: "ok", events: [], next: undefined };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { state: "not-configured" };

  const limit = normalizedAuditLogLimit(options.limit);
  const [{ createPgQueryExecutor }, { createSqlAuditLogStore }] = await Promise.all([
    import("@boardreadyops/db/pg-executor"),
    import("@boardreadyops/db/audit-log-store"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    // The session records GitHub's installation ids; audit_events is keyed by the internal id.
    // Resolving them here rather than trusting a request parameter is what scopes the listing.
    const result = await executor.query(installationsQuery, [session.installationIds]);
    const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
    const installationIds = rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
    if (installationIds.length === 0) return { state: "ok", events: [], next: undefined };

    const page = await createSqlAuditLogStore(executor).listAuditEvents({
      installationId: installationIds,
      ...(options.repositoryId ? { repositoryId: options.repositoryId } : {}),
      ...(options.eventType ? { eventType: options.eventType } : {}),
      ...(options.cursor ? { cursor: { createdAt: new Date(options.cursor.createdAt), id: options.cursor.id } } : {}),
      // One row beyond the page tells us whether a next cursor is needed, with no count query.
      limit: limit + 1,
    });

    const events = page.slice(0, limit);
    const last = events.at(-1);
    const next =
      page.length > events.length && last
        ? encodeAuditLogCursor({ createdAt: last.createdAt, id: last.id })
        : undefined;
    return { state: "ok", events, next };
  } finally {
    await executor.close();
  }
}
