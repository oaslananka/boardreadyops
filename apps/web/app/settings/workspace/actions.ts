"use server";

import type { WorkspaceMemberRecord } from "@boardreadyops/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import { type ResolvedGitHubMemberIdentity, resolveGitHubMemberIdentity } from "../../../lib/github-member-identity.js";
import { defineAction } from "../../../lib/server-action.js";
import { openWorkspaceStore } from "../../../lib/workspace-store-access.js";

const roleValues = ["owner", "admin", "member", "viewer"] as const;
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u;

const loginField = z
  .string()
  .trim()
  .min(1, "Enter a GitHub username.")
  .max(39)
  .regex(loginPattern, "That is not a valid GitHub username.");

const resolveSchema = z.object({
  workspaceId: z.string().min(1),
  userId: loginField,
});

const upsertSchema = z.object({
  workspaceId: z.string().min(1),
  userId: loginField,
  githubUserId: z.coerce.number().int().positive(),
  role: z.enum(roleValues),
});

const removeSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
});

function refuseMemberManagement(actorRole: string | null, targetRole?: (typeof roleValues)[number]) {
  if (!actorRole) return "Workspace not found.";
  if (actorRole !== "owner" && actorRole !== "admin") return "Only owners and admins can manage members.";
  if (actorRole === "admin" && targetRole === "owner") return "Only an owner can grant ownership.";
  return undefined;
}

function resolutionFailure(status: "not_found" | "unsupported" | "unavailable", login: string) {
  if (status === "not_found") return fail(`GitHub has no user called "${login}". Check the spelling.`);
  if (status === "unsupported") return fail("Workspace access can be granted only to an individual GitHub user.");
  return fail("GitHub identity could not be verified right now. No access was granted; try again.");
}

export const resolveWorkspaceMemberIdentityAction = defineAction(resolveSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const actor = { githubUserId: session.userId, login: session.login };
    const actorRole = await store.workspaceRoleFor(input.workspaceId, actor);
    const refusal = refuseMemberManagement(actorRole);
    if (refusal) return fail(refusal);

    const resolved = await resolveGitHubMemberIdentity(input.userId);
    if (resolved.status !== "resolved") return resolutionFailure(resolved.status, input.userId);

    return ok(
      resolved.identity,
      `Found @${resolved.identity.login}. Confirm the identity and role before granting access.`,
    );
  } finally {
    await executor.close();
  }
});

export const upsertWorkspaceMemberAction = defineAction(upsertSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const actor = { githubUserId: session.userId, login: session.login };
    const actorRole = await store.workspaceRoleFor(input.workspaceId, actor);
    const refusal = refuseMemberManagement(actorRole, input.role);
    if (refusal) return fail(refusal);

    const resolved = await resolveGitHubMemberIdentity(input.userId);
    if (resolved.status !== "resolved") return resolutionFailure(resolved.status, input.userId);
    if (resolved.identity.githubUserId !== input.githubUserId) {
      return fail("GitHub identity changed since it was reviewed. Resolve the username again before granting access.");
    }

    if (resolved.identity.githubUserId === session.userId && actorRole === "owner" && input.role !== "owner") {
      const members = await store.listWorkspaceMembers(input.workspaceId);
      const owners = members.filter((member: WorkspaceMemberRecord) => member.role === "owner");
      if (owners.length <= 1) return fail("Promote another owner before giving up ownership.");
    }

    const member = await store.upsertWorkspaceMember({
      workspaceId: input.workspaceId,
      subject: resolved.identity,
      actor,
      role: input.role,
    });

    revalidatePath("/settings/workspace");
    return ok(
      { userId: member.githubLogin, githubUserId: member.githubUserId, role: member.role },
      `@${member.githubLogin} is now ${member.role}.`,
    );
  } finally {
    await executor.close();
  }
});

export const removeWorkspaceMemberAction = defineAction(removeSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const actor = { githubUserId: session.userId, login: session.login };
    const actorRole = await store.workspaceRoleFor(input.workspaceId, actor);
    const refusal = refuseMemberManagement(actorRole);
    if (refusal) return fail(refusal);

    const removed = await store.removeWorkspaceMember({
      workspaceId: input.workspaceId,
      userId: input.userId,
      actor,
    });
    if (!removed) return fail("That member could not be removed. A workspace must keep an owner.");

    revalidatePath("/settings/workspace");
    return ok({ userId: input.userId }, `${input.userId} no longer has access.`);
  } finally {
    await executor.close();
  }
});

export type WorkspaceMemberIdentityPreview = ResolvedGitHubMemberIdentity;
