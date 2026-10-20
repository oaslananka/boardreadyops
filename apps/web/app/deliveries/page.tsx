import type { WorkspaceDeliveryRecord, WorkspaceRevisionRecord } from "@boardreadyops/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { DeliveryCreateForm } from "../../components/deliveries/delivery-create-form.js";
import { DeliveryRevokeButton } from "../../components/deliveries/delivery-revoke-button.js";
import { ManufacturingShareAuthorizationForm } from "../../components/deliveries/manufacturing-share-authorization-form.js";
import { ValidatedRevisionRegisterForm } from "../../components/deliveries/validated-revision-register-form.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { Alert, EmptyState, Pagination, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { WorkspaceSwitcher } from "../../components/workspace-switcher.js";
import { deliveryExpired, loadWorkspaceDeliveries } from "../../lib/delivery-listing.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import {
  authorizeManufacturingShareAction,
  createDeliveryLinkAction,
  registerValidatedRevisionAction,
  revokeDeliveryLinkAction,
  revokeManufacturingShareAction,
} from "./actions.js";

export const metadata: Metadata = {
  title: "Release Deliveries & Fabrication Packages",
  description: "Token-bound guest access to stored manufacturing release artifacts and integrity checks.",
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

function revisionSourceLabel(sourceKind: WorkspaceRevisionRecord["sourceKind"]): string {
  if (sourceKind === "github_commit") return "GitHub";
  if (sourceKind === "native_export") return "CLI";
  return "Web/API";
}

function revisionColumns(): readonly DataColumn<WorkspaceRevisionRecord>[] {
  return [
    {
      id: "revision",
      header: "Revision",
      rowHeader: true,
      cell: (revision) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{revision.revisionLabel}</span>
          <span className="text-meta text-muted-foreground">{revision.projectName}</span>
        </span>
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: (revision) => <span>{revisionSourceLabel(revision.sourceKind)}</span>,
    },
    {
      id: "evidence",
      header: "Package evidence",
      cell: (revision) =>
        revision.validationRunId && revision.validationArtifactId ? (
          <span className="flex flex-col gap-0.5">
            <StatusBadge value="success" label="Validated" />
            <span className="font-mono text-meta text-muted-foreground">{revision.bundleSha256.slice(0, 12)}…</span>
          </span>
        ) : (
          <StatusBadge value="warning" label="Not delivery-eligible" />
        ),
    },
    {
      id: "commit",
      header: "Commit",
      cell: (revision) =>
        revision.commitSha ? (
          <code className="text-meta">{revision.commitSha.slice(0, 12)}</code>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}

function deliveryColumns(
  canRevoke: boolean,
  authorizedRevisionIds: readonly string[],
): readonly DataColumn<WorkspaceDeliveryRecord>[] {
  return [
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
        ) : !authorizedRevisionIds.includes(delivery.revisionId) ? (
          <StatusBadge value="warning" label="Sharing not authorized" />
        ) : (
          <StatusBadge value="success" label="Live" />
        ),
    },
    {
      id: "archive",
      header: "Legacy reference",
      cell: (delivery) =>
        delivery.signedArchiveUrl ? (
          <span className="font-mono text-meta break-all">{delivery.signedArchiveUrl}</span>
        ) : (
          <span className="text-meta text-muted-foreground">First-party artifact</span>
        ),
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
    {
      id: "actions",
      header: "Actions",
      align: "end",
      cell: (delivery) =>
        canRevoke ? (
          <DeliveryRevokeButton
            deliveryId={delivery.id}
            projectName={delivery.projectName}
            expired={deliveryExpired(delivery)}
            action={revokeDeliveryLinkAction}
          />
        ) : null,
    },
  ];
}

export default async function DeliveriesListPage({ searchParams }: Readonly<DeliveriesPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const result = await loadWorkspaceDeliveries(
    viewer.session,
    first(parameters.workspace),
    process.env,
    parameters.page,
  );

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
            Guest links that let a manufacturing partner download the stored evidence-backed package without an account.
            Anyone holding one can open it until it expires, so this is the list of what is currently outstanding.
          </p>
        </header>

        {result.state === "ok" ? (
          <>
            <WorkspaceSwitcher workspaces={result.workspaces} selectedId={result.selected.id} basePath="/deliveries" />

            <Panel
              title="Package revisions"
              description="Revisions keep their ingestion provenance. Only evidence-backed revisions can be shared."
            >
              <DataTable
                caption={`Package revisions in ${result.selected.name}`}
                columns={revisionColumns()}
                rows={result.revisions}
                rowKey={(revision) => revision.id}
                empty={
                  <EmptyState
                    title="No package revisions yet"
                    action={
                      <Button asChild variant="outline">
                        <Link href="/runs">Inspect runs</Link>
                      </Button>
                    }
                  >
                    <p>
                      Start with a passing run that produced a manufacturing archive. Register its validated evidence
                      here before sharing.
                    </p>
                  </EmptyState>
                }
              />
            </Panel>

            {result.selected.role !== "viewer" && result.revisionCandidates.length > 0 ? (
              <Panel
                title="Register validated revision"
                description="Turn persisted manufacturing evidence from a passing BoardReadyOps run into a shareable revision."
              >
                <ValidatedRevisionRegisterForm
                  workspaceId={result.selected.id}
                  candidates={result.revisionCandidates}
                  action={registerValidatedRevisionAction}
                />
              </Panel>
            ) : null}

            {(result.selected.role === "owner" || result.selected.role === "admin") &&
            result.revisions.some((revision) => revision.validationRunId && revision.validationArtifactId) ? (
              <Panel
                title="Explicit permission to share"
                description="Readiness checks are not manufacturing approval. An owner/admin must separately permit
                  guest sharing for one exact source commit and archive checksum."
              >
                <ManufacturingShareAuthorizationForm
                  revisions={result.revisions.filter(
                    (revision) => revision.validationRunId && revision.validationArtifactId,
                  )}
                  authorizedRevisionIds={result.authorizedRevisionIds ?? []}
                  approveAction={authorizeManufacturingShareAction}
                  revokeAction={revokeManufacturingShareAction}
                />
              </Panel>
            ) : null}

            <Panel title={result.selected.name} description="Newest first. An expired link stops working on its own.">
              <DataTable
                caption={`Guest delivery links in ${result.selected.name}`}
                columns={deliveryColumns(result.selected.role !== "viewer", result.authorizedRevisionIds ?? [])}
                rows={result.deliveries}
                rowKey={(delivery) => delivery.id}
                empty={
                  <EmptyState
                    title="No guest links yet"
                    action={
                      result.selected.role !== "viewer" &&
                      result.revisions.some((revision) => revision.validationRunId && revision.validationArtifactId) ? (
                        <Button asChild variant="outline">
                          <a href="#share-package">Create a guest link</a>
                        </Button>
                      ) : null
                    }
                  >
                    <p>Links you issue appear here until they expire. Only validated revisions can be shared.</p>
                  </EmptyState>
                }
              />
              <div className="mt-4">
                <Pagination
                  basePath="/deliveries"
                  page={result.page}
                  totalPages={result.totalPages}
                  pageParameter="page"
                  searchParameters={{ workspace: result.selected.id }}
                />
              </div>
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

/** Public delivery creation is intentionally limited to revisions whose trusted evidence binding survives a fresh DB check. */
function CreatePanel({
  result,
  origin,
}: Readonly<{
  result: Extract<Awaited<ReturnType<typeof loadWorkspaceDeliveries>>, { state: "ok" }>;
  origin: string;
}>) {
  const validatedRevisions = result.revisions.filter(
    (revision) =>
      revision.validationRunId !== undefined &&
      revision.validationArtifactId !== undefined &&
      (result.authorizedRevisionIds ?? []).includes(revision.id),
  );

  if (validatedRevisions.length === 0) {
    return (
      <Panel id="share-package" title="Share a package">
        <Alert tone="info" title="No validated revisions to share yet">
          Run BoardReadyOps on a connected GitHub project until it completes with a passing manufacturing archive, then
          register that artifact as a revision above. Guest links are not issued for revision records without live
          validation evidence.
          <div className="mt-3">
            <Button asChild variant="outline">
              <Link href="/runs">Inspect runs</Link>
            </Button>
          </div>
        </Alert>
      </Panel>
    );
  }

  return (
    <Panel
      id="share-package"
      title="Share a package"
      description="Only validated revisions are selectable. The guest link is shown once and only its hash is stored."
    >
      <DeliveryCreateForm
        revisions={validatedRevisions.map((revision) => ({
          id: revision.id,
          label: `${revision.projectName} · ${revision.revisionLabel} · ${revisionSourceLabel(revision.sourceKind)}`,
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

  // Existing GitHub reviews do not imply a workspace or a verified manufacturing package.
  // Keep both journeys accessible without fabricating delivery eligibility.
  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-2" aria-label="Choose your next delivery step">
      <Panel
        title="Review your boards"
        description="Existing GitHub readiness runs and published Reviews remain available without a CAD workspace."
      >
        <p className="text-sm text-muted-foreground">
          Work through findings and pending decisions before preparing a manufacturing handoff. A Review is not a signed
          delivery package.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/reviews">Open Reviews</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/runs">Browse runs</Link>
          </Button>
        </div>
      </Panel>
      <Panel
        title="Prepare a manufacturing delivery"
        description="Delivery links require a CAD workspace project revision and a validated manufacturing archive from a passing run."
      >
        <p className="text-sm text-muted-foreground">
          Creating a workspace alone does not approve a design or issue a guest link. Register eligible evidence before
          sharing a package with a manufacturing partner.
        </p>
        <Button asChild className="mt-4">
          <Link href="/projects">Set up a CAD workspace</Link>
        </Button>
      </Panel>
    </section>
  );
}
