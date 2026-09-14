import { notificationEventCatalog } from "@boardreadyops/cloud-core/notifications";
import Link from "next/link";
import {
  NotificationChannelCreateForm,
  NotificationChannelEditForm,
} from "../../../components/settings/notification-channel-forms.js";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { Alert, EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { resolveNotificationAdminScope } from "../../../lib/notification-admin.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import {
  createNotificationChannelAction,
  deleteNotificationChannelAction,
  updateNotificationChannelAction,
} from "./actions.js";

export const metadata = {
  title: "Notifications",
  description: "Where BoardReadyOps tells you a board is blocked or a part went end-of-life.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type NotificationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function when(value: string | undefined): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

const eventLabels = new Map(notificationEventCatalog.map((event) => [event.type, event.label]));

const channelKindLabel: Record<string, string> = { email: "Email", slack: "Slack", webhook: "Webhook" };

export default async function NotificationsSettingsPage({ searchParams }: Readonly<NotificationsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <Panel title="Notifications">
        <EmptyState
          title="Sign in to choose where you are told"
          action={
            <Button asChild>
              <a href="/api/auth/github/login">Sign in with GitHub</a>
            </Button>
          }
        >
          <p>Notification channels belong to a GitHub App installation, so BoardReadyOps needs to know who you are.</p>
        </EmptyState>
      </Panel>
    );
  }

  const scope = await resolveNotificationAdminScope(viewer.session, first(parameters.installation));

  if (scope.installations.length === 0) {
    return (
      <Panel title="Notifications">
        <EmptyState
          title="No installation to notify about yet"
          action={
            <Button asChild>
              <Link href="/setup">Go to Setup</Link>
            </Button>
          }
        >
          <p>Install the BoardReadyOps GitHub App on a repository, then come back to choose where it tells you.</p>
        </EmptyState>
      </Panel>
    );
  }

  const selected = scope.selected;
  if (!selected) {
    return (
      <Panel title="Notifications">
        <EmptyState title="That installation is unavailable">
          <p>Pick a different installation, or reload the page.</p>
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Notifications"
        description="BoardReadyOps watches designs between commits. This is where it tells you what it found."
        actions={
          scope.installations.length > 1 ? (
            <form method="get" className="flex items-center gap-2">
              <label htmlFor="notifications-installation" className="sr-only">
                Installation
              </label>
              <NativeSelect id="notifications-installation" name="installation" defaultValue={selected.id}>
                {scope.installations.map((installation) => (
                  <option key={installation.id} value={installation.id}>
                    {installation.accountLogin}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" size="sm" variant="outline">
                Switch
              </Button>
            </form>
          ) : undefined
        }
      >
        {scope.storageUnavailable ? (
          <Alert title="This deployment cannot store notification channels" tone="warning">
            <p>No database is configured, so channels cannot be saved. Everything below is read-only.</p>
          </Alert>
        ) : (
          <Alert title="Supply risk is the one that arrives early" tone="info">
            <p>
              A blocked release is something you would find anyway, next time you looked. A part going end-of-life on a
              board nobody has touched in four months is not — that one only reaches you if something tells you.
            </p>
          </Alert>
        )}
      </Panel>

      <Panel
        title="Add a channel"
        description={
          scope.emailAvailable
            ? "Slack, an email address, or any HTTPS endpoint you control."
            : "Slack, or any HTTPS endpoint you control."
        }
      >
        <NotificationChannelCreateForm
          installationId={selected.id}
          action={createNotificationChannelAction}
          emailAvailable={scope.emailAvailable}
        />
        {scope.emailAvailable ? null : (
          <p className="mt-3 text-meta text-muted-foreground">
            Email is not offered because this deployment has no SMTP relay. An operator enables it by setting{" "}
            <code>BOARDREADYOPS_NOTIFICATION_SMTP_URL</code> and <code>BOARDREADYOPS_NOTIFICATION_EMAIL_FROM</code>.
          </p>
        )}
      </Panel>

      <Panel title={`Channels for ${selected.accountLogin}`} tone="section">
        {scope.channels.length === 0 ? (
          <EmptyState title="Nothing is being notified yet">
            <p>Add a channel above and BoardReadyOps will start telling you when a board needs someone.</p>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {scope.channels.map((channel) => (
              <article key={channel.id} className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-foreground">{channel.label}</h3>
                    <p className="mt-0.5 font-mono text-meta text-muted-foreground break-all">{channel.destination}</p>
                    <p className="mt-1 text-meta text-muted-foreground">
                      {channelKindLabel[channel.kind] ?? channel.kind} · added by {channel.createdBy} · last delivered{" "}
                      {when(channel.lastDeliveredAt)}
                    </p>
                  </div>
                  <StatusBadge
                    value={channel.enabled ? "ready" : "stale"}
                    label={channel.enabled ? "Delivering" : "Paused"}
                  />
                </header>

                {channel.lastError ? (
                  <p className="rounded-md border border-warning/40 bg-warning-surface p-2.5 text-meta text-foreground">
                    Last delivery failed: {channel.lastError}
                  </p>
                ) : null}

                <p className="text-meta text-muted-foreground">
                  {channel.subscribedEvents.length === 0
                    ? "Subscribed to nothing, so nothing is sent."
                    : channel.subscribedEvents.map((event) => eventLabels.get(event) ?? event).join(" · ")}
                </p>

                <details className="border-t border-border pt-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">Change what this receives</summary>
                  <div className="mt-3">
                    <NotificationChannelEditForm
                      installationId={selected.id}
                      channel={channel}
                      updateAction={updateNotificationChannelAction}
                      deleteAction={deleteNotificationChannelAction}
                    />
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
