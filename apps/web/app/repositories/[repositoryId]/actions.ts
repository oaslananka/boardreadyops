"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import { resolveTokenAdminScope } from "../../../lib/api-token-admin.js";
import { defineAction } from "../../../lib/server-action.js";

const findingMutationSchema = z.object({
  repositoryId: z.string().min(1),
  findingId: z.string().min(1),
});

const acknowledgeSchema = findingMutationSchema;

const suppressSchema = findingMutationSchema.extend({
  reason: z.string().trim().min(3).max(500),
  duration: z.enum(["1d", "7d", "30d"]),
});

const clearSuppressionSchema = findingMutationSchema;

const suppressionDurationMs = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

function revalidateSupplyFindingSurfaces(repositoryId: string): void {
  revalidatePath(`/repositories/${repositoryId}`);
  revalidatePath("/dashboard");
  revalidatePath("/parts");
}

export const acknowledgeSupplyFindingAction = defineAction(acknowledgeSchema, async (input, { session }) => {
  const scope = await resolveTokenAdminScope(session, input.repositoryId);
  if (!scope.selected) return fail("Supply finding not found.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ createSqlSupplyFindingStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db/supply-finding-store"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const outcome = await createSqlSupplyFindingStore(executor).acknowledge(
      scope.selected.id,
      input.findingId,
      session.login,
      new Date(),
    );
    if (outcome === "not_found") return fail("Supply finding not found.");

    revalidateSupplyFindingSurfaces(scope.selected.id);

    return outcome === "already_acknowledged"
      ? ok({ acknowledged: false }, "Supply finding was already acknowledged.")
      : ok({ acknowledged: true }, "Supply finding acknowledged.");
  } finally {
    await executor.close();
  }
});

export const suppressSupplyFindingAction = defineAction(suppressSchema, async (input, { session }) => {
  const scope = await resolveTokenAdminScope(session, input.repositoryId);
  if (!scope.selected) return fail("Supply finding not found.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ createSqlSupplyFindingStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db/supply-finding-store"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + suppressionDurationMs[input.duration]);

  try {
    const outcome = await createSqlSupplyFindingStore(executor).suppress(
      scope.selected.id,
      input.findingId,
      session.login,
      input.reason,
      expiresAt,
      now,
    );
    if (outcome === "not_found") return fail("Supply finding not found.");

    revalidateSupplyFindingSurfaces(scope.selected.id);
    return outcome === "already_suppressed"
      ? ok({ suppressed: false }, "Supply finding is already suppressed.")
      : ok({ suppressed: true }, `Supply finding alerts suppressed until ${expiresAt.toISOString()}.`);
  } finally {
    await executor.close();
  }
});

export const clearSupplyFindingSuppressionAction = defineAction(clearSuppressionSchema, async (input, { session }) => {
  const scope = await resolveTokenAdminScope(session, input.repositoryId);
  if (!scope.selected) return fail("Supply finding not found.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ createSqlSupplyFindingStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db/supply-finding-store"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const outcome = await createSqlSupplyFindingStore(executor).clearSuppression(
      scope.selected.id,
      input.findingId,
      session.login,
      new Date(),
    );
    if (outcome === "not_found") return fail("Supply finding not found.");

    revalidateSupplyFindingSurfaces(scope.selected.id);
    return outcome === "not_suppressed"
      ? ok({ cleared: false }, "Supply finding alerts are already active.")
      : ok({ cleared: true }, "Supply finding alerts resumed.");
  } finally {
    await executor.close();
  }
});
