"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createLegalHoldForViewer,
  releaseLegalHoldForViewer,
  requestErasureForViewer,
  requestExportForViewer,
  saveRetentionPolicyForViewer,
} from "../../../lib/data-settings-admin.js";
import { defineAction } from "../../../lib/server-action.js";

/**
 * Data-lifecycle actions. Both mirror the request bodies of `/api/v1/data-exports` and
 * `/api/v1/erasure-requests`, which had no UI consumer at all — the settings page described the
 * retention tiers and offered no way to act on them.
 *
 * Tenant ids are resolved server-side from the viewer's authorized GitHub App installation.
 * Form values never become tenant authority.
 */

const scopes = ["organization", "repository", "user"] as const;

const exportSchema = z.object({
  installationId: z.string().min(1),
  scope: z.enum(scopes).default("organization"),
  scopeId: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim())),
});

const erasureSchema = exportSchema.extend({
  dryRun: z.union([z.literal("on"), z.literal("")]).optional(),
  confirm: z.string(),
});

export const requestExportAction = defineAction(exportSchema, async (input, { session }) =>
  requestExportForViewer(session, input),
);

export const requestErasureAction = defineAction(erasureSchema, async (input, { session }) =>
  requestErasureForViewer(session, { ...input, dryRun: input.dryRun === "on" }),
);

const retentionPolicySchema = z.object({
  installationId: z.string().min(1),
  retentionDays: z.string().max(4).optional(),
});

const legalHoldSchema = z.object({
  installationId: z.string().min(1),
  scope: z.enum(scopes),
  scopeId: z
    .string()
    .max(256)
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim())),
  reason: z.string().trim().min(10, "Give the legal hold a reason of at least 10 characters.").max(500),
});

const releaseLegalHoldSchema = z.object({
  installationId: z.string().min(1),
  holdId: z.string().min(1),
});

export const saveRetentionPolicyAction = defineAction(retentionPolicySchema, async (input, { session }) => {
  const result = await saveRetentionPolicyForViewer(session, input);
  if (result.status === "ok") revalidatePath("/settings/data");
  return result;
});

export const createLegalHoldAction = defineAction(legalHoldSchema, async (input, { session }) => {
  const result = await createLegalHoldForViewer(session, input);
  if (result.status === "ok") revalidatePath("/settings/data");
  return result;
});

export const releaseLegalHoldAction = defineAction(releaseLegalHoldSchema, async (input, { session }) => {
  const result = await releaseLegalHoldForViewer(session, input);
  if (result.status === "ok") revalidatePath("/settings/data");
  return result;
});
