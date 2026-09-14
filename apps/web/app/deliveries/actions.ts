"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../lib/action-result.js";
import { defineAction } from "../../lib/server-action.js";
import { openWorkspaceStore } from "../../lib/workspace-store-access.js";

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

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
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

/**
 * Ends a guest link before its expiry.
 *
 * Until this existed a link could only be waited out: a package shared with the wrong fabricator
 * stayed readable for up to ninety days with nothing anyone could do about it. The link is
 * expired rather than deleted so the record of who was given what, and when it was withdrawn,
 * survives in the delivery list.
 */
const revokeSchema = z.object({
  deliveryId: z.string().min(1),
});

export const revokeDeliveryLinkAction = defineAction(revokeSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    // Same shape as minting: the delivery id is a form value, so the workspace it belongs to is
    // resolved server-side and membership re-read before the link is closed.
    const workspaceId = await store.workspaceIdForDelivery(input.deliveryId);
    if (!workspaceId) return fail("Delivery link not found.");
    const role = await store.workspaceRoleFor(workspaceId, session.login);
    if (!role) return fail("Delivery link not found.");
    if (role === "viewer") return fail("Viewers cannot revoke delivery links.");

    const revoked = await store.revokeDeliveryLink(input.deliveryId);
    if (!revoked) return fail("That link has already expired or been revoked.");
    revalidatePath("/deliveries");
    return ok(undefined, "Link revoked. The recipient can no longer open it.");
  } finally {
    await executor.close();
  }
});
