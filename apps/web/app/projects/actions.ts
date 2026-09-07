"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../lib/action-result.js";
import { defineAction } from "../../lib/server-action.js";
import { openWorkspaceStore } from "../../lib/workspace-store-access.js";

/**
 * Both actions are top-level exports capturing nothing from an enclosing scope — every value
 * arrives in the FormData, which keeps them off Next's encrypted-closure path.
 *
 * Neither trusts a workspace id from the form. `createProject` re-reads the caller's membership
 * before writing, because the form is the one thing on the page an attacker controls entirely.
 */

const slugPattern = /^[a-z0-9-]+$/u;

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Give the workspace a name.").max(128),
  slug: z
    .string()
    .trim()
    .min(1, "Give the workspace a URL slug.")
    .max(64)
    .regex(slugPattern, "Use lowercase letters, numbers and hyphens only."),
});

const createProjectSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, "Give the project a name.").max(128),
  description: z.string().trim().max(1024).optional(),
  defaultCadFormat: z.enum(["kicad", "altium", "easyeda", "fusion360", "ipc2581", "generic_gerber"]).default("kicad"),
});

export const createWorkspaceAction = defineAction(createWorkspaceSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const existing = await store.getWorkspaceBySlug(input.slug);
    if (existing) return fail("That slug is already taken.");

    // The creator becomes the owner in the same statement that inserts the workspace, so one can
    // never exist with no member — which is the state that made the v2 API unauthorizable.
    const workspace = await store.createWorkspace({
      name: input.name,
      slug: input.slug,
      ownerUserId: session.login,
    });
    revalidatePath("/projects");
    return ok({ workspaceId: workspace.id }, `Created ${workspace.name}.`);
  } finally {
    await executor.close();
  }
});

export const createProjectAction = defineAction(createProjectSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    // Re-authorized here rather than trusted from the form: the workspace id is a hidden input,
    // and a hidden input is a suggestion. Same answer for "not a member" and "does not exist",
    // so a guessed id cannot be used to discover which ids are real.
    const role = await store.workspaceRoleFor(input.workspaceId, session.login);
    if (!role) return fail("Workspace not found.");
    if (role === "viewer") return fail("Viewers cannot create projects.");

    const project = await store.createProject({
      workspaceId: input.workspaceId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      defaultCadFormat: input.defaultCadFormat,
    });
    revalidatePath("/projects");
    return ok({ projectId: project.id }, `Created ${project.name}.`);
  } finally {
    await executor.close();
  }
});
