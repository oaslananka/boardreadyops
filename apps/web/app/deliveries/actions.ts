"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../lib/action-result.js";
import { defineAction } from "../../lib/server-action.js";

/**
 * Minting a guest delivery link.
 *
 * The result is a public URL that reads a signed archive with no account, so the authorization
 * here is the only thing standing between a form post and someone else's manufacturing package.
 * The revision id arrives in the form, which means it is a suggestion: the handler resolves the
 * workspace that revision belongs to and re-reads the caller's membership before writing.
 *
 * The raw token is returned exactly once, to be shown and then forgotten. It is never stored --
 * only its hash is -- so a lost link cannot be recovered, only replaced.
 */

const createSchema = z.object({
  revisionId: z.string().min(1, "Pick a revision to share."),
  signedArchiveUrl: z
    .string()
    .trim()
    .min(1, "Give the archive URL the recipient should download.")
    .max(2048)
    .url("That is not a valid URL."),
  recipientNotes: z.string().trim().max(2048).optional(),
  expiresInDays: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? 7 : Number(value)))
    .refine((value) => Number.isInteger(value) && value >= 1 && value <= 90, "Expiry must be between 1 and 90 days."),
});

export const createDeliveryLinkAction = defineAction(createSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const [{ WorkspaceStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const store = new WorkspaceStore(executor);
    // Same answer for "not a member" and "no such revision", so a guessed id cannot be used to
    // discover which revisions exist.
    const workspaceId = await store.workspaceIdForRevision(input.revisionId);
    const role = workspaceId ? await store.workspaceRoleFor(workspaceId, session.login) : null;
    if (!role) return fail("Revision not found.");
    if (role === "viewer") return fail("Viewers cannot create delivery links.");

    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
    const { delivery, rawToken } = await store.createDeliveryLink({
      revisionId: input.revisionId,
      expiresAt,
      signedArchiveUrl: input.signedArchiveUrl,
      ...(input.recipientNotes ? { recipientNotes: input.recipientNotes } : {}),
    });

    revalidatePath("/deliveries");
    return ok(
      { token: rawToken, deliveryId: delivery.id, expiresAt: delivery.expiresAt },
      "Guest link created. Copy it now — it is not shown again.",
    );
  } finally {
    await executor.close();
  }
});
