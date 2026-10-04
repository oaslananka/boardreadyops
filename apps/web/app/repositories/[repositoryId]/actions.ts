"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import { resolveTokenAdminScope } from "../../../lib/api-token-admin.js";
import { defineAction } from "../../../lib/server-action.js";

const acknowledgeSchema = z.object({
  repositoryId: z.string().min(1),
  findingId: z.string().min(1),
});

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

    revalidatePath(`/repositories/${scope.selected.id}`);
    revalidatePath("/dashboard");
    revalidatePath("/parts");

    return outcome === "already_acknowledged"
      ? ok({ acknowledged: false }, "Supply finding was already acknowledged.")
      : ok({ acknowledged: true }, "Supply finding acknowledged.");
  } finally {
    await executor.close();
  }
});
