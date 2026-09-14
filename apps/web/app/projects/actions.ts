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

/**
 * Deleting names the thing being deleted back to the server.
 *
 * `confirmName` must match the record's current name. A yes/no dialog is the wrong control for a
 * cascade: `projects`, `revisions` and `deliveries` all cascade from `workspaces`, so one careless
 * click can take a month of release evidence with it. Typing the name is the cheapest control that
 * makes the action deliberate, and it costs a careful user four seconds.
 */
const renameProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "Give the project a name.").max(128),
});

const deleteProjectSchema = z.object({
  projectId: z.string().min(1),
  confirmName: z.string().trim().min(1, "Type the project name to confirm."),
});

const renameWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, "Give the workspace a name.").max(128),
});

const deleteWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
  confirmName: z.string().trim().min(1, "Type the workspace name to confirm."),
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

/** Owners and admins may rename a project; viewers may not. */
export const renameProjectAction = defineAction(renameProjectSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    // The project id is a hidden input, so the workspace it belongs to is resolved server-side
    // and the caller's membership re-read before anything is written.
    const workspaceId = await store.workspaceIdForProject(input.projectId);
    if (!workspaceId) return fail("Project not found.");
    const role = await store.workspaceRoleFor(workspaceId, session.login);
    if (!role) return fail("Project not found.");
    if (role === "viewer") return fail("Viewers cannot rename projects.");

    const renamed = await store.renameProject(input.projectId, input.name);
    if (!renamed) return fail("Project not found.");
    revalidatePath("/projects");
    return ok(undefined, `Renamed to ${input.name}.`);
  } finally {
    await executor.close();
  }
});

/** Only an owner may delete a project, and only by typing its name. */
export const deleteProjectAction = defineAction(deleteProjectSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const workspaceId = await store.workspaceIdForProject(input.projectId);
    if (!workspaceId) return fail("Project not found.");
    const role = await store.workspaceRoleFor(workspaceId, session.login);
    if (!role) return fail("Project not found.");
    if (role !== "owner") return fail("Only a workspace owner can delete a project.");

    const projects = await store.listProjectsByWorkspace(workspaceId);
    const project = projects.find((entry) => entry.id === input.projectId);
    if (!project) return fail("Project not found.");
    if (input.confirmName !== project.name) {
      return fail(`Type the project name exactly — "${project.name}" — to confirm.`);
    }

    const impact = await store.projectDeletionImpact(input.projectId);
    const deleted = await store.deleteProject(input.projectId);
    if (!deleted) return fail("Project not found.");
    revalidatePath("/projects");
    return ok(
      undefined,
      `Deleted ${project.name}, with ${impact.revisions} revision(s) and ${impact.deliveries} delivery link(s).`,
    );
  } finally {
    await executor.close();
  }
});

export const renameWorkspaceAction = defineAction(renameWorkspaceSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const role = await store.workspaceRoleFor(input.workspaceId, session.login);
    if (!role) return fail("Workspace not found.");
    if (role !== "owner" && role !== "admin") return fail("Only owners and admins can rename a workspace.");

    const renamed = await store.renameWorkspace(input.workspaceId, input.name);
    if (!renamed) return fail("Workspace not found.");
    revalidatePath("/projects");
    revalidatePath("/settings/workspace");
    return ok(undefined, `Renamed to ${input.name}.`);
  } finally {
    await executor.close();
  }
});

/**
 * Only an owner may delete a workspace, and only by typing its name.
 *
 * The slug is not reused afterwards by anything, but everything beneath the workspace is removed
 * by cascade, so the confirmation message states the counts the caller was shown.
 */
export const deleteWorkspaceAction = defineAction(deleteWorkspaceSchema, async (input, { session }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fail("This deployment has no database configured.");

  const { store, executor } = await openWorkspaceStore(connectionString);
  try {
    const role = await store.workspaceRoleFor(input.workspaceId, session.login);
    if (!role) return fail("Workspace not found.");
    if (role !== "owner") return fail("Only a workspace owner can delete it.");

    const workspace = await store.getWorkspaceById(input.workspaceId);
    if (!workspace) return fail("Workspace not found.");
    if (input.confirmName !== workspace.name) {
      return fail(`Type the workspace name exactly — "${workspace.name}" — to confirm.`);
    }

    const impact = await store.workspaceDeletionImpact(input.workspaceId);
    const deleted = await store.deleteWorkspace(input.workspaceId);
    if (!deleted) return fail("Workspace not found.");
    revalidatePath("/projects");
    revalidatePath("/settings/workspace");
    return ok(
      undefined,
      `Deleted ${workspace.name}, with ${impact.projects} project(s), ${impact.revisions} revision(s) and ${impact.deliveries} delivery link(s).`,
    );
  } finally {
    await executor.close();
  }
});
