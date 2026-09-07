"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import { resolveTokenAdminScope } from "../../../lib/api-token-admin.js";
import { defineAction } from "../../../lib/server-action.js";

/**
 * Both actions are top-level exports that capture nothing from an enclosing scope — every value
 * arrives in the FormData. That keeps them off Next's encrypted-closure path, which needs a
 * stable NEXT_SERVER_ACTIONS_ENCRYPTION_KEY shared by every replica to decrypt reliably.
 *
 * `repositoryId` is re-authorized inside each handler rather than trusted from the form.
 */

const scopeValues = ["runs:write", "reviews:read", "reviews:write", "admin"] as const;

const createSchema = z.object({
  repositoryId: z.string().min(1),
  name: z.string().min(1, "Give the token a name.").max(128),
  // A checkbox group posts a bare string when exactly one box is ticked.
  scopes: z
    .union([z.enum(scopeValues), z.array(z.enum(scopeValues))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .refine((value) => value.length > 0, "Pick at least one scope."),
  durationDays: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" || value === "never" ? undefined : Number(value)))
    .refine(
      (value) => value === undefined || (Number.isInteger(value) && value >= 1 && value <= 365),
      "Expiry must be between 1 and 365 days.",
    ),
});

const revokeSchema = z.object({
  repositoryId: z.string().min(1),
  tokenId: z.string().min(1),
});

export const createTokenAction = defineAction(createSchema, async (input, { session }) => {
  const scope = await resolveTokenAdminScope(session, input.repositoryId);
  if (!scope.selected) return fail("You cannot administer that repository.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ ApiTokenStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const created = await new ApiTokenStore(executor).createToken({
      repositoryId: scope.selected.id,
      name: input.name,
      scopes: input.scopes,
      createdBy: session.login,
      ...(input.durationDays === undefined ? {} : { durationDays: input.durationDays }),
    });
    revalidatePath("/settings/tokens");
    // The plaintext is returned once, to the caller that asked for it, and never re-read.
    return ok({ token: created.token, prefix: created.record.tokenPrefix }, `Token "${input.name}" created.`);
  } finally {
    await executor.close();
  }
});

export const revokeTokenAction = defineAction(revokeSchema, async (input, { session }) => {
  const scope = await resolveTokenAdminScope(session, input.repositoryId);
  if (!scope.selected) return fail("You cannot administer that repository.");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ ApiTokenStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const revoked = await new ApiTokenStore(executor).revokeToken(scope.selected.id, input.tokenId);
    if (!revoked) return fail("That token no longer exists.");
    revalidatePath("/settings/tokens");
    return ok(undefined, "Token revoked.");
  } finally {
    await executor.close();
  }
});
