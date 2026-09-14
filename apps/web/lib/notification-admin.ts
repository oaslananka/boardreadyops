import {
  isNotificationEventType,
  maskNotificationDestination,
  type NotificationChannelKind,
  type NotificationEventType,
  validateNotificationDestination,
} from "@boardreadyops/cloud-core/notifications";
import type { NotificationChannelRecord } from "@boardreadyops/db/notification-store";
import { emailNotificationsAvailable } from "./notification-worker.js";
import type { UserSession } from "./user-session.js";
import { viewerInstallations } from "./viewer-installations.js";

/**
 * Reading and authorizing notification channels for a settings page.
 *
 * Channels belong to an installation, not to a repository, because a Slack channel is how a
 * team wants to hear about all of its boards rather than one. Authorization therefore resolves
 * through `viewerInstallations`, which already filters to the installations the session
 * recorded and drops suspended and cancelled ones.
 */

export type NotificationChannelView = {
  id: string;
  kind: NotificationChannelKind;
  label: string;
  /** Masked: enough to recognise the destination, never enough to reuse it. */
  destination: string;
  subscribedEvents: readonly NotificationEventType[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastDeliveredAt: string | undefined;
  lastError: string | undefined;
};

export type NotificationAdminScope = {
  installations: readonly { id: string; accountLogin: string }[];
  selected: { id: string; accountLogin: string } | undefined;
  channels: readonly NotificationChannelView[];
  /** True when this deployment cannot store channels at all. */
  storageUnavailable: boolean;
  /**
   * Whether an email channel can be offered.
   *
   * False unless the deployment has an SMTP relay and an envelope sender. The kind is then
   * absent from the form and refused by the action, rather than accepted into a channel that
   * would dead-letter on its first delivery.
   */
  emailAvailable: boolean;
};

function toChannelView(record: NotificationChannelRecord): NotificationChannelView {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    destination: maskNotificationDestination(record.destination),
    subscribedEvents: record.subscribedEvents,
    enabled: record.enabled,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    lastDeliveredAt: record.lastDeliveredAt,
    lastError: record.lastError,
  };
}

/** Parses the event checkbox group a form posts, dropping anything not in the catalogue. */
export function parseSubscribedEvents(value: string | readonly string[] | undefined): NotificationEventType[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value as string];
  return values.filter(isNotificationEventType);
}

export function parseChannelKind(value: unknown): NotificationChannelKind | undefined {
  return value === "email" || value === "slack" || value === "webhook" ? value : undefined;
}

/** Re-checks a destination at the boundary, never trusting the one the browser validated. */
export function checkDestination(
  kind: NotificationChannelKind,
  destination: string,
): { ok: true } | { ok: false; reason: string } {
  return validateNotificationDestination(kind, destination);
}

export async function resolveNotificationAdminScope(
  session: UserSession | undefined,
  requestedInstallationId: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<NotificationAdminScope> {
  const empty: NotificationAdminScope = {
    installations: [],
    selected: undefined,
    channels: [],
    storageUnavailable: !environment.DATABASE_URL,
    emailAvailable: emailNotificationsAvailable(environment),
  };
  if (!session) return empty;

  const installations = (await viewerInstallations(session, "nexar", environment)).map((installation) => ({
    id: installation.id,
    accountLogin: installation.accountLogin,
  }));
  if (installations.length === 0) return { ...empty, installations };

  const selected = installations.find((entry) => entry.id === requestedInstallationId) ?? installations[0];
  if (!selected) return { ...empty, installations };

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) return { ...empty, installations, selected, storageUnavailable: true };

  const [{ createPgQueryExecutor }, { createSqlNotificationStore }] = await Promise.all([
    import("@boardreadyops/db/pg-executor"),
    import("@boardreadyops/db/notification-store"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  try {
    const records = await createSqlNotificationStore(executor).listChannels(selected.id);
    return {
      installations,
      selected,
      channels: records.map(toChannelView),
      storageUnavailable: false,
      emailAvailable: emailNotificationsAvailable(environment),
    };
  } finally {
    await executor.close();
  }
}

/** Confirms the session may administer this installation before any write. */
export async function authorizeInstallationForNotifications(
  session: UserSession,
  installationId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
  const installations = await viewerInstallations(session, "nexar", environment);
  return installations.some((installation) => installation.id === installationId);
}
