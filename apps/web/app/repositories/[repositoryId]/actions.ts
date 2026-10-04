"use server";

import type { SupplyFindingStore } from "@boardreadyops/db/supply-finding-store";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "../../../lib/action-result.js";
import { resolveTokenAdminScope } from "../../../lib/api-token-admin.js";
import { defineAction } from "../../../lib/server-action.js";
import type { UserSession } from "../../../lib/user-session.js";

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

type SupplyFindingMutationContext = {
  repositoryId: string;
  actor: string;
  store: SupplyFindingStore;
};

async function withSupplyFindingStore<Output>(
  session: UserSession,
  requestedRepositoryId: string,
  mutate: (context: SupplyFindingMutationContext) => Promise<ActionResult<Output>>,
): Promise<ActionResult<Output>> {
  const scope = await resolveTokenAdminScope(session, requestedRepositoryId);
  if (!scope.selected) return fail("Supply finding not found.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ createSqlSupplyFindingStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db/supply-finding-store"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });

  try {
    return await mutate({
      repositoryId: scope.selected.id,
      actor: session.login,
      store: createSqlSupplyFindingStore(executor),
    });
  } finally {
    await executor.close();
  }
}

export const acknowledgeSupplyFindingAction = defineAction(acknowledgeSchema, async (input, { session }) =>
  withSupplyFindingStore(session, input.repositoryId, async ({ repositoryId, actor, store }) => {
    const outcome = await store.acknowledge(repositoryId, input.findingId, actor, new Date());
    if (outcome === "not_found") return fail("Supply finding not found.");

    revalidateSupplyFindingSurfaces(repositoryId);
    return outcome === "already_acknowledged"
      ? ok({ acknowledged: false }, "Supply finding was already acknowledged.")
      : ok({ acknowledged: true }, "Supply finding acknowledged.");
  }),
);

export const suppressSupplyFindingAction = defineAction(suppressSchema, async (input, { session }) =>
  withSupplyFindingStore(session, input.repositoryId, async ({ repositoryId, actor, store }) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + suppressionDurationMs[input.duration]);
    const outcome = await store.suppress(repositoryId, input.findingId, actor, input.reason, expiresAt, now);
    if (outcome === "not_found") return fail("Supply finding not found.");

    revalidateSupplyFindingSurfaces(repositoryId);
    return outcome === "already_suppressed"
      ? ok({ suppressed: false }, "Supply finding is already suppressed.")
      : ok({ suppressed: true }, `Supply finding alerts suppressed until ${expiresAt.toISOString()}.`);
  }),
);

export const clearSupplyFindingSuppressionAction = defineAction(clearSuppressionSchema, async (input, { session }) =>
  withSupplyFindingStore(session, input.repositoryId, async ({ repositoryId, actor, store }) => {
    const outcome = await store.clearSuppression(repositoryId, input.findingId, actor, new Date());
    if (outcome === "not_found") return fail("Supply finding not found.");

    revalidateSupplyFindingSurfaces(repositoryId);
    return outcome === "not_suppressed"
      ? ok({ cleared: false }, "Supply finding alerts are already active.")
      : ok({ cleared: true }, "Supply finding alerts resumed.");
  }),
);
