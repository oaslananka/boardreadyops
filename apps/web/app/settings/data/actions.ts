"use server";

import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import { defineAction } from "../../../lib/server-action.js";

/**
 * Data-lifecycle actions. Both mirror the request bodies of `/api/v1/data-exports` and
 * `/api/v1/erasure-requests`, which had no UI consumer at all — the settings page described the
 * retention tiers and offered no way to act on them.
 *
 * Tenancy follows the same simplified mapping the API routes use (the viewer's login), so the UI
 * and the endpoint cannot request different scopes for the same person.
 */

const scopes = ["organization", "repository", "user"] as const;

const exportSchema = z.object({
  scope: z.enum(scopes).default("organization"),
  scopeId: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim())),
});

const erasureSchema = exportSchema.extend({
  /** Checkbox: present means "preview only", absent means the real thing. */
  dryRun: z.union([z.literal("on"), z.literal("")]).optional(),
  /** Typed confirmation, checked server-side so the guard is not just a client nicety. */
  confirm: z.string(),
});

async function lifecycleStore(): Promise<
  | { ok: true; store: InstanceType<typeof import("@boardreadyops/db").DataLifecycleStore>; close: () => Promise<void> }
  | { ok: false }
> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { ok: false };
  const [{ DataLifecycleStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  return { ok: true, store: new DataLifecycleStore(executor), close: () => executor.close() };
}

export const requestExportAction = defineAction(exportSchema, async (input, { session }) => {
  const opened = await lifecycleStore();
  if (!opened.ok) return fail("This deployment has no database configured.");
  try {
    const record = await opened.store.createExport({
      tenantId: session.login,
      requestedBy: session.login,
      scope: input.scope,
      scopeId: input.scopeId ?? null,
    });
    return ok(
      { exportId: record.id, status: record.status },
      "Export requested. It is generated asynchronously and the download link is time-limited.",
    );
  } finally {
    await opened.close();
  }
});

export const requestErasureAction = defineAction(erasureSchema, async (input, { session }) => {
  const expected = input.scopeId ?? session.login;
  if (input.confirm.trim() !== expected) {
    return fail(`Type "${expected}" exactly to confirm.`, { confirm: ["Confirmation does not match."] });
  }

  const opened = await lifecycleStore();
  if (!opened.ok) return fail("This deployment has no database configured.");
  try {
    const record = await opened.store.createErasure({
      tenantId: session.login,
      requestedBy: session.login,
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      dryRun: input.dryRun === "on",
    });
    if (record.status === "blocked_by_hold") {
      return fail("An active legal hold covers this scope, so nothing was erased.");
    }
    return ok(
      { erasureId: record.id, status: record.status, dryRun: record.dryRun },
      record.dryRun
        ? "Preview recorded. Nothing was deleted — review the scope before running it for real."
        : "Erasure requested. It is processed asynchronously and cannot be undone.",
    );
  } finally {
    await opened.close();
  }
});
