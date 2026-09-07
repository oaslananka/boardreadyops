import type { WorkspaceDeliveryRecord } from "@boardreadyops/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { DeliveryCreateForm } from "../../components/deliveries/delivery-create-form.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { Alert, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { WorkspaceSwitcher } from "../../components/workspace-switcher.js";
import { deliveryExpired, loadWorkspaceDeliveries } from "../../lib/delivery-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import { createDeliveryLinkAction } from "./actions.js";

export const metadata: Metadata = {
  title: "Release Deliveries & Fabrication Packages",
  description: "Cryptographically signed manufacturing release deliveries and guest links.",
};

// Scoped to the viewer's workspace memberships, so it can never be prerendered.
export const dynamic = "force-dynamic";

export type DeliveriesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function day(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().slice(0, 10);
}

const columns: readonly DataColumn<WorkspaceDeliveryRecord>[] = [
  {
    id: "revision",
    header: "Revision",
    rowHeader: true,
    cell: (delivery) => (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{delivery.revisionLabel}</span>
        <span className="text-meta text-muted-foreground">{delivery.projectName}</span>
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (delivery) =>
      deliveryExpired(delivery) ? (
        <StatusBadge value="neutral" label="Expired" />
      ) : (
        <StatusBadge value="success" label="Live" />
      ),
  },
  {
    id: "archive",
    header: "Archive",
    cell: (delivery) => <span className="font-mono text-meta break-all">{delivery.signedArchiveUrl}</span>,
  },
  {
    id: "notes",
    header: "Recipient notes",
    cell: (delivery) =>
      delivery.recipientNotes ? (
        <span className="break-words">{delivery.recipientNotes}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "expires",
    header: "Expires",
    align: "end",
    cell: (delivery) => (
      <time dateTime={delivery.expiresAt} className="text-muted-foreground tabular-nums">
        {day(delivery.expiresAt)}
      </time>
    ),
  },
];

export default async function DeliveriesListPage({ searchParams }: Readonly<DeliveriesPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const result = await loadWorkspaceDeliveries(viewer.session, first(parameters.workspace));

  // The copied value has to be a URL the recipient can open, so the origin comes from the request
  // rather than being assumed.
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "";

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Deliveries" }]}
    >
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Release Deliveries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Guest links that let a manufacturing partner download a signed package without an account. Anyone holding
            one can open it until it expires, so this is the list of what is currently outstanding.
          </p>
        </header>

        {result.state === "ok" ? (
          <>
            <WorkspaceSwitcher workspaces={result.workspaces} selectedId={result.selected.id} basePath="/deliveries" />

            <Panel title={result.selected.name} description="Newest first. An expired link stops working on its own.">
              <DataTable
                caption={`Guest delivery links in ${result.selected.name}`}
                columns={columns}
                rows={result.deliveries}
                rowKey={(delivery) => delivery.id}
                empty={
                  <EmptyState title="No guest links yet">
                    <p>Links you issue appear here until they expire, so nothing you have handed out is invisible.</p>
                  </EmptyState>
                }
              />
            </Panel>

            {result.selected.role === "viewer" ? null : <CreatePanel result={result} origin={origin} />}
          </>
        ) : (
          <DeliveriesUnavailable state={result.state} />
        )}
      </main>
    </AppShell>
  );
}

/**
 * The create form only appears when there is something to share. A revision exists once a package
 * has been uploaded, and that upload is API-only today -- so the empty case says that plainly
 * rather than showing a picker with nothing in it.
 */
function CreatePanel({
  result,
  origin,
}: Readonly<{
  result: Extract<Awaited<ReturnType<typeof loadWorkspaceDeliveries>>, { state: "ok" }>;
  origin: string;
}>) {
  if (result.revisions.length === 0) {
    return (
      <Panel title="Share a package">
        <Alert tone="info" title="No revisions to share yet">
          A guest link points at a revision, and a revision is recorded when a manufacturing package is uploaded for a
          project. That upload runs through <code className="font-mono">POST /api/v2/revisions/upload</code> today — the
          hosted upload path is not connected yet.
        </Alert>
      </Panel>
    );
  }

  return (
    <Panel
      title="Share a package"
      description="The link is shown once and only its hash is stored, so it cannot be recovered later."
    >
      <DeliveryCreateForm
        revisions={result.revisions.map((revision) => ({
          id: revision.id,
          label: `${revision.projectName} · ${revision.revisionLabel}`,
        }))}
        origin={origin}
        action={createDeliveryLinkAction}
      />
    </Panel>
  );
}

function DeliveriesUnavailable({ state }: Readonly<{ state: "signed-out" | "not-configured" | "no-workspaces" }>) {
  if (state === "signed-out") {
    return (
      <Panel title="Deliveries">
        <EmptyState title="Sign in to see your delivery links">
          <p>Guest links belong to a workspace, and a workspace is scoped to the people in it.</p>
          <Button asChild className="mt-3">
            <a href="/api/auth/github/login">Sign in with GitHub</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  if (state === "not-configured") {
    return (
      <Panel title="Deliveries">
        <EmptyState title="Deliveries are not configured">
          <p>This deployment has no control-plane database, so guest links cannot be issued or recorded.</p>
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel title="Deliveries">
      <EmptyState title="Create a workspace first">
        <p>Deliveries hang off a project revision, and projects live in a workspace.</p>
        <Button asChild className="mt-3">
          <Link href="/projects">Go to Projects</Link>
        </Button>
      </EmptyState>
    </Panel>
  );
}
