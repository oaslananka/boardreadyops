import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "../../../components/ui/button.js";
import { CursorPagination, type DataColumn, DataTable } from "../../../components/ui/data-table.js";
import { Input } from "../../../components/ui/input.js";
import { EmptyState, Panel } from "../../../components/ui.js";
import {
  type AuditLogEntry,
  decodeAuditLogCursor,
  loadAuditLog,
  normalizedAuditLogLimit,
  normalizedEventType,
} from "../../../lib/audit-log-listing.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const metadata: Metadata = {
  title: "Audit Log",
  description: "Every consequential action recorded against the installations you can see.",
};

// Scoped to the viewer's installations and cursor-paginated, so it can never be prerendered.
export const dynamic = "force-dynamic";

export type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function when(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 19);
}

/** `github_app.installation.suspended` reads as three things; the last is what happened. */
function eventParts(eventType: string): { scope: string; action: string } {
  const segments = eventType.split(".");
  const action = segments.at(-1) ?? eventType;
  return { scope: segments.slice(0, -1).join(" · "), action: action.replaceAll("_", " ") };
}

function actorLabel(event: AuditLogEntry): string {
  if (event.actorLogin) return event.actorLogin;
  if (event.actorType === "system") return "BoardReadyOps";
  return event.actorId ? `${event.actorType} ${event.actorId}` : event.actorType;
}

const columns: readonly DataColumn<AuditLogEntry>[] = [
  {
    id: "event",
    header: "Event",
    rowHeader: true,
    cell: (event) => {
      const { scope, action } = eventParts(event.eventType);
      return (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{action}</span>
          <span className="text-meta text-muted-foreground">{scope || event.subjectType}</span>
        </span>
      );
    },
  },
  {
    id: "actor",
    header: "Actor",
    cell: (event) => (
      <span className="flex flex-col gap-0.5">
        <span>{actorLabel(event)}</span>
        <span className="text-meta text-muted-foreground">{event.actorType}</span>
      </span>
    ),
  },
  {
    id: "subject",
    header: "Subject",
    cell: (event) => (
      <span className="flex flex-col gap-0.5">
        {event.repositoryFullName ? (
          <Link href={`/repositories/${event.repositoryId}`} className="text-primary hover:underline">
            {event.repositoryFullName}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {event.releaseRunId ? (
          <Link href={`/runs/${event.releaseRunId}`} className="text-meta font-mono text-primary hover:underline">
            run {event.releaseRunId.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-meta text-muted-foreground">
            {event.subjectType}
            {event.subjectId ? ` ${event.subjectId.slice(0, 24)}` : ""}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "when",
    header: "When",
    align: "end",
    // <time> is masked in the visual baselines, so a new event does not churn a screenshot.
    cell: (event) => (
      <time dateTime={event.createdAt} className="text-muted-foreground tabular-nums">
        {when(event.createdAt)}
      </time>
    ),
  },
];

type AuditListing = Awaited<ReturnType<typeof loadAuditLog>>;

function AuditLogContent({ listing, eventType }: Readonly<{ listing: AuditListing; eventType: string | undefined }>) {
  if (listing.state === "not-configured") {
    return (
      <EmptyState title="Audit events are not stored">
        <p>This deployment has no control-plane database, so there is nothing to record against.</p>
      </EmptyState>
    );
  }

  if (listing.state === "signed-out") {
    return (
      <EmptyState title="Sign in to read your audit log">
        <p>Events are scoped to the installations your GitHub account can see.</p>
        <Button asChild className="mt-3">
          <a href="/api/auth/github/login">Sign in with GitHub</a>
        </Button>
      </EmptyState>
    );
  }

  const emptyTitle = eventType ? "No events of that type" : "No events recorded yet";
  const emptyDescription = eventType
    ? "Nothing matched that event type. Clear the filter to see everything."
    : "Events appear here as soon as something happens: a run finishes, a review is decided, an installation changes.";

  return (
    <>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-meta font-medium text-foreground" htmlFor="audit-event-type">
            Event type
          </label>
          <Input
            id="audit-event-type"
            name="event"
            defaultValue={eventType ?? ""}
            placeholder="github_app.installation.suspended"
            maxLength={160}
            aria-describedby="audit-event-type-hint"
          />
          <p id="audit-event-type-hint" className="text-meta text-muted-foreground">
            An exact event type. Copy one from a row you are interested in.
          </p>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {eventType ? (
          <Button asChild variant="ghost">
            <Link href="/settings/audit">Clear</Link>
          </Button>
        ) : null}
      </form>

      <DataTable
        caption="Audit events across every visible installation"
        columns={columns}
        rows={listing.events}
        rowKey={(event) => event.id}
        empty={
          <EmptyState title={emptyTitle}>
            <p>{emptyDescription}</p>
          </EmptyState>
        }
      />
    </>
  );
}

export default async function AuditPage({ searchParams }: Readonly<AuditPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const cursor = decodeAuditLogCursor(first(parameters.cursor));
  const limit = normalizedAuditLogLimit(Number(first(parameters.limit)) || undefined);
  const eventType = normalizedEventType(first(parameters.event));

  const listing = await loadAuditLog(viewer.session, {
    ...(cursor ? { cursor } : {}),
    ...(eventType ? { eventType } : {}),
    limit,
  });

  const next = listing.state === "ok" ? listing.next : undefined;

  return (
    <>
      {/* No heading of its own: the settings layout owns the page's h1. */}
      <Panel
        title="Audit log"
        description="Every consequential action recorded against the installations your account can see, newest first. Entries are append-only — the database refuses to update or delete one."
      >
        <AuditLogContent listing={listing} eventType={eventType} />
      </Panel>

      <CursorPagination
        basePath="/settings/audit"
        searchParameters={{ limit: first(parameters.limit), event: eventType }}
        {...(next ? { nextCursor: next } : {})}
        label="Audit log pagination"
      />
    </>
  );
}
