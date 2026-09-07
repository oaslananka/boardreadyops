"use server";

import type { WorkspaceMemberRecord } from "@boardreadyops/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import { defineAction } from "../../../lib/server-action.js";
import { openWorkspaceStore } from "../../../lib/workspace-store-access.js";

/**
 * Workspace membership is what every v2 surface authorizes against, so these two handlers are the
 * only place access to a workspace can be granted or taken away. Every rule below is enforced
 * here rather than in the form, because the form is the part an attacker controls.
 */

/** Matches the `workspace_members.role` check constraint in migration 0064. */
const roleValues = ["owner", "admin", "member", "viewer"] as const;

/** GitHub's own login rule: alphanumeric or single hyphens, not leading or trailing, max 39. */
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u;

const upsertSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z
    .string()
    .trim()
    .min(1, "Enter a GitHub username.")
    .max(39)
    .regex(loginPattern, "That is not a valid GitHub username."),
  role: z.enum(roleValues),
});

const removeSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
});

/** Only owners and admins manage members; an admin cannot mint an owner above themselves. */
function refuseMemberManagement(actorRole: string | null, targetRole?: (typeof roleValues)[number]) {
  // Same answer for "not a member" and "no such workspace", so a guessed id proves nothing.
  if (!actorRole) return "Workspace not found.";
  if (actorRole !== "owner" && actorRole !== "admin") return "Only owners and admins can manage members.";
  if (actorRole === "admin" && targetRole === "owner") return "Only an owner can grant ownership.";
  return undefined;
}

export const upsertWorkspaceMemberAction = defineAction(upsertSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const actorRole = await store.workspaceRoleFor(input.workspaceId, session.login);
    const refusal = refuseMemberManagement(actorRole, input.role);
    if (refusal) return fail(refusal);

    // Demoting yourself out of ownership is how a workspace loses its last owner without anyone
    // being removed, so it is refused for the same reason removal is.
    if (input.userId === session.login && actorRole === "owner" && input.role !== "owner") {
      const members = await store.listWorkspaceMembers(input.workspaceId);
      const owners = members.filter((member: WorkspaceMemberRecord) => member.role === "owner");
      if (owners.length <= 1) return fail("Promote another owner before giving up ownership.");
    }

    const member = await store.upsertWorkspaceMember({
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
    });

    revalidatePath("/settings/workspace");
    return ok({ userId: member.userId, role: member.role }, `${member.userId} is now ${member.role}.`);
  } finally {
    await executor.close();
  }
});

export const removeWorkspaceMemberAction = defineAction(removeSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const actorRole = await store.workspaceRoleFor(input.workspaceId, session.login);
    const refusal = refuseMemberManagement(actorRole);
    if (refusal) return fail(refusal);

    const removed = await store.removeWorkspaceMember(input.workspaceId, input.userId);
    // The store refuses to remove the last owner in the same statement that deletes, so a false
    // here means either that or no such member. Both read the same to the caller, and neither is
    // worth distinguishing: the workspace still has an owner either way.
    if (!removed) return fail("That member could not be removed. A workspace must keep an owner.");

    revalidatePath("/settings/workspace");
    return ok({ userId: input.userId }, `${input.userId} no longer has access.`);
  } finally {
    await executor.close();
  }
});
