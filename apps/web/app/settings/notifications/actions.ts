"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok } from "../../../lib/action-result.js";
import {
  authorizeInstallationForNotifications,
  checkDestination,
  parseChannelKind,
  parseSubscribedEvents,
} from "../../../lib/notification-admin.js";
import { emailNotificationsAvailable } from "../../../lib/notification-worker.js";
import { defineAction } from "../../../lib/server-action.js";

/**
 * Notification channel administration.
 *
 * Every action re-resolves the installation from the session rather than trusting the id in the
 * form, and re-validates the destination URL server-side: a notification destination is a URL
 * the control plane will POST to on its own schedule, so accepting one the browser merely said
 * was fine would hand a caller a request-forgery primitive.
 */

const eventValues = z.union([z.string(), z.array(z.string())]).optional();

const createSchema = z.object({
  installationId: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1, "Give the channel a name you will recognise.").max(80),
  destination: z.string().min(1, "Paste the webhook URL.").max(2048),
  events: eventValues,
});

const updateSchema = z.object({
  installationId: z.string().min(1),
  channelId: z.string().min(1),
  events: eventValues,
  enabled: z.string().optional(),
});

const deleteSchema = z.object({
  installationId: z.string().min(1),
  channelId: z.string().min(1),
});

async function notificationStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  const [{ createPgQueryExecutor }, { createSqlNotificationStore }] = await Promise.all([
    import("@boardreadyops/db/pg-executor"),
    import("@boardreadyops/db/notification-store"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  return { store: createSqlNotificationStore(executor), close: () => executor.close() };
}

export const createNotificationChannelAction = defineAction(createSchema, async (input, { session }) => {
  const kind = parseChannelKind(input.kind);
  if (!kind) return fail("Pick a destination kind.");
  if (kind === "email" && !emailNotificationsAvailable()) {
    return fail("This deployment has no SMTP relay configured, so it cannot send email.");
  }
  if (!(await authorizeInstallationForNotifications(session, input.installationId))) {
    return fail("You cannot administer that installation.");
  }

  const destination = input.destination.trim();
  const destinationCheck = checkDestination(kind, destination);
  if (!destinationCheck.ok) return fail(destinationCheck.reason);

  const events = parseSubscribedEvents(input.events);
  if (events.length === 0) return fail("Choose at least one thing to be told about.");

  const connection = await notificationStore();
  if (!connection) return fail("This deployment has no database configured.");
  try {
    const created = await connection.store.createChannel({
      installationId: input.installationId,
      kind,
      destination,
      label: input.label.trim(),
      subscribedEvents: events,
      createdBy: session.login,
    });
    if (created.outcome === "duplicate") return fail("That destination is already set up for this installation.");
    revalidatePath("/settings/notifications");
    return ok(undefined, `"${input.label.trim()}" will now be notified.`);
  } finally {
    await connection.close();
  }
});

export const updateNotificationChannelAction = defineAction(updateSchema, async (input, { session }) => {
  if (!(await authorizeInstallationForNotifications(session, input.installationId))) {
    return fail("You cannot administer that installation.");
  }
  const events = parseSubscribedEvents(input.events);
  if (events.length === 0) return fail("Choose at least one thing to be told about, or delete the channel.");

  const connection = await notificationStore();
  if (!connection) return fail("This deployment has no database configured.");
  try {
    const outcome = await connection.store.updateChannel({
      installationId: input.installationId,
      channelId: input.channelId,
      subscribedEvents: events,
      // An unchecked checkbox posts nothing at all, which is how "disabled" arrives here.
      enabled: input.enabled === "on",
    });
    if (outcome === "not_found") return fail("That channel no longer exists.");
    revalidatePath("/settings/notifications");
    return ok(undefined, "Channel updated.");
  } finally {
    await connection.close();
  }
});

export const deleteNotificationChannelAction = defineAction(deleteSchema, async (input, { session }) => {
  if (!(await authorizeInstallationForNotifications(session, input.installationId))) {
    return fail("You cannot administer that installation.");
  }
  const connection = await notificationStore();
  if (!connection) return fail("This deployment has no database configured.");
  try {
    const outcome = await connection.store.deleteChannel({
      installationId: input.installationId,
      channelId: input.channelId,
    });
    if (outcome === "not_found") return fail("That channel no longer exists.");
    revalidatePath("/settings/notifications");
    return ok(undefined, "Channel removed. Nothing will be sent to it again.");
  } finally {
    await connection.close();
  }
});
