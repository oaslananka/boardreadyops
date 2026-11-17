import { hasWorkspaceEntitlement } from "@boardreadyops/cloud-core";
import type { WorkspaceDeliveryRecord, WorkspaceRevisionRecord } from "@boardreadyops/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
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
import { resolveBillingMode } from "../../lib/billing-mode.js";
import { deliveryExpired, loadWorkspaceDeliveries } from "../../lib/delivery-listing.js";
import { canonicalRepositoryName } from "../../lib/review-list-filters.js";
import { loadViewerRuns, type RunListingEntry } from "../../lib/run-listing.js";
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
            <StatusBadge
              value={revision.sourceBinding === "source-bound-verified" ? "success" : "warning"}
              label={
                revision.sourceBinding === "source-bound-verified" ? "Source-bound verified" : "Not delivery-eligible"
              }
            />
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
  const requestedRepository = first(parameters.repository);
  const selectedRepository =
    requestedRepository === undefined ? undefined : canonicalRepositoryName(requestedRepository);
  // Never silently discard an invalid scope and show unrelated repositories.
  const invalidRepositoryFilter = requestedRepository !== undefined && selectedRepository === undefined;
  const viewer = await viewerAuthorization();
  const result = await loadWorkspaceDeliveries(
    viewer.session,
    first(parameters.workspace),
    process.env,
    parameters.page,
  );

  // Signed Run evidence is repository-scoped, never a delivery from the
  // selected workspace. Reuse the live GitHub installation grant checks.
  const signedRunListing =
    !invalidRepositoryFilter && viewer.session && (result.state === "ok" || result.state === "no-workspaces")
      ? await loadViewerRuns(
          viewer.session,
          {
            limit: 3,
            signedManufacturingOnly: true,
            ...(selectedRepository ? { repository: selectedRepository } : {}),
          },
          process.env,
        )
      : undefined;

  // The copied value has to be a URL the recipient can open, so the origin comes from the request
  // rather than being assumed.
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "";

  // Repository-scoped signed evidence and workspace delivery records are separate views.
  // Never allow a malformed repository scope to reveal unrelated signed archives.
  let signedArchiveContent: ReactNode = null;
  if (invalidRepositoryFilter) {
    signedArchiveContent = (
      <Panel title="Invalid repository filter">
        <p className="text-sm text-muted-foreground">
          The requested repository is not a valid GitHub owner/name. No signed Run archives were loaded.{" "}
          <Link href="/deliveries" className="font-semibold text-primary underline underline-offset-2">
            Browse authorized signed archives
          </Link>
        </p>
      </Panel>
    );
  } else if (signedRunListing?.state === "ok" && signedRunListing.runs.length > 0) {
    signedArchiveContent = (
      <SignedRunArchivesPanel
        runs={signedRunListing.runs}
        {...(selectedRepository ? { repository: selectedRepository } : {})}
      />
    );
  } else if (selectedRepository) {
    let statusTitle = "Signed archive eligibility cannot be verified";
    let statusBody: ReactNode = (
      <p className="text-sm text-muted-foreground">
        Your repository access or archive listing is temporarily unavailable. Do not interpret missing evidence as a
        passing manufacturing result.
      </p>
    );
    if (signedRunListing?.state === "ok") {
      statusTitle = `No signed manufacturing archive for ${selectedRepository}`;
      statusBody = (
        <>
          <p className="text-sm text-muted-foreground">
            There is no currently accessible, stored, signed manufacturing Run archive for this repository. A Review,
            findings or an unsigned Run can still exist; this is not evidence that the board is ready for fabrication.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/reviews?repository=${encodeURIComponent(selectedRepository)}`}
              className="font-semibold text-primary underline underline-offset-2"
            >
              Return to this repository&apos;s Reviews
            </Link>
            <Link href="/deliveries" className="font-semibold text-primary underline underline-offset-2">
              Browse all authorized signed archives
            </Link>
          </div>
        </>
      );
    }
    signedArchiveContent = <Panel title={statusTitle}>{statusBody}</Panel>;
  }

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Deliveries" }]}
    >
      <main id="main-content" className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Release Deliveries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect signed Run archives from repositories you can access, then manage package revisions and guest links
            in the selected workspace. A verified archive is not a delivery or fabrication approval.
          </p>
        </header>

        {signedArchiveContent}

        {selectedRepository && result.state === "ok" ? (
          <p className="text-sm text-muted-foreground">
            Package revisions and guest links below belong to the selected workspace; they are not filtered by GitHub
            repository. Verify the source and workspace before sharing anything.
          </p>
        ) : null}

        {result.state === "ok" ? (
          <>
            <WorkspaceSwitcher workspaces={result.workspaces} selectedId={result.selected.id} basePath="/deliveries" />

            <Panel
              title="Package revisions"
              description="An accepted runner result and stored archive do not independently attest source-to-export provenance or approve fabrication."
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
                      result.selected.role !== "viewer" && result.revisionCandidates.length > 0 ? (
                        <Button asChild variant="outline">
                          <a href="#register-run-backed-revision">Register an eligible Run</a>
                        </Button>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="outline">
                            <Link href="/reviews">Review boards</Link>
                          </Button>
                          <Button asChild variant="ghost">
                            <Link href="/runs">Inspect runs</Link>
                          </Button>
                        </div>
                      )
                    }
                  >
                    <p>
                      {result.revisionCandidates.length > 0
                        ? "A run-backed archive candidate is available in this workspace. Inspect its source and validation evidence before registering a revision; this does not approve fabrication."
                        : "No manufacturing package revision is registered in this workspace. A passing Run, including one from another repository, does not automatically become a delivery. Inspect its evidence and resolve outstanding Review blockers first."}
                    </p>
                  </EmptyState>
                }
              />
            </Panel>

            {result.selected.role !== "viewer" && result.revisionCandidates.length > 0 ? (
              <Panel
                id="register-run-backed-revision"
                title="Register run-backed revision"
                description="Register a stored manufacturing archive from an accepted passing runner result. The source-to-export status is shown per package; legacy/manual packages remain usable without being promoted to source-bound verified."
              >
                <ValidatedRevisionRegisterForm
                  workspaceId={result.selected.id}
                  candidates={result.revisionCandidates}
                  action={registerValidatedRevisionAction}
                />
              </Panel>
            ) : null}

            {(result.selected.role === "owner" || result.selected.role === "admin") &&
            result.revisions.some((revision) => revision.sourceBinding === "source-bound-verified") ? (
              <Panel
                title="Explicit permission to share"
                description="Readiness checks and source attestation are not manufacturing approval. An owner/admin must separately permit
                  guest sharing for one exact source commit and archive checksum."
              >
                <ManufacturingShareAuthorizationForm
                  revisions={result.revisions.filter((revision) => revision.sourceBinding === "source-bound-verified")}
                  authorizedRevisionIds={result.authorizedRevisionIds ?? []}
                  approveAction={authorizeManufacturingShareAction}
                  revokeAction={revokeManufacturingShareAction}
                />
              </Panel>
            ) : null}

            <Panel
              title="Guest links"
              description={`Shared from workspace ${result.selected.name}. Newest first; expired links stop working automatically.`}
            >
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
                      hasWorkspaceEntitlement(result.selected.planTier, "canCreateDeliveryLink") &&
                      result.revisions.some(
                        (revision) =>
                          revision.sourceBinding === "source-bound-verified" &&
                          (result.authorizedRevisionIds ?? []).includes(revision.id),
                      ) ? (
                        <Button asChild variant="outline">
                          <a href="#share-package">Create a guest link</a>
                        </Button>
                      ) : null
                    }
                  >
                    <p>
                      Links you issue appear here until they expire. Only source-bound verified revisions with explicit
                      owner/admin approval can be shared.
                    </p>
                  </EmptyState>
                }
              />
              <div className="mt-4">
                <Pagination
                  basePath="/deliveries"
                  page={result.page}
                  totalPages={result.totalPages}
                  pageParameter="page"
                  searchParameters={{
                    workspace: result.selected.id,
                    ...(selectedRepository ? { repository: selectedRepository } : {}),
                  }}
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

/**
 * Browser-facing discovery only. This never creates a workspace revision,
 * shares a package, or mints download capabilities.
 */
function SignedRunArchivesPanel({
  runs,
  repository,
}: Readonly<{ runs: readonly RunListingEntry[]; repository?: string }>) {
  return (
    <Panel
      title={repository ? `Signed Run archives for ${repository}` : "Signed Run archives \u2014 not deliveries"}
      description={
        repository
          ? "Signed manufacturing Run evidence for this repository under your verified GitHub installation grants. These are not deliveries."
          : "Source-bound manufacturing evidence from GitHub repositories your current installations can access, including other workspaces."
      }
    >
      <ul className="space-y-3" aria-label="Signed manufacturing Run evidence">
        {runs.map((run) => (
          <li
            key={run.id}
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-semibold text-foreground">{run.repository}</p>
              <p className="text-xs text-muted-foreground">
                Source commit <code className="break-all font-mono">{run.commitSha.slice(0, 12)}</code>
                {" · "}
                <StatusBadge value={run.decision} label={run.decision ?? "Not verified"} />
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button asChild variant="outline" className="min-h-11">
                <Link href={`/runs/${encodeURIComponent(run.id)}/artifacts`}>Inspect BOM and Gerber files</Link>
              </Button>
              <Link
                href={`/runs/${encodeURIComponent(run.id)}/design`}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
              >
                Inspect PCB / schematic
              </Link>
              {canonicalRepositoryName(run.repository) ? (
                <Link
                  href={`/reviews?repository=${encodeURIComponent(canonicalRepositoryName(run.repository) ?? "")}`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                >
                  Review decisions
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        These records are not package revisions in the selected workspace and are not fabrication approval. Inspect the
        exact source and archive, then register an eligible revision and obtain explicit owner permission before issuing
        a guest link.
      </p>
    </Panel>
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
      revision.sourceBinding === "source-bound-verified" &&
      revision.validationRunId !== undefined &&
      revision.validationArtifactId !== undefined &&
      (result.authorizedRevisionIds ?? []).includes(revision.id),
  );

  if (!hasWorkspaceEntitlement(result.selected.planTier, "canCreateDeliveryLink")) {
    const freeBeta = resolveBillingMode() === "beta_free";
    return (
      <Panel id="share-package" title="Share a package">
        <Alert
          tone="info"
          title={freeBeta ? "Guest links are unavailable during free beta" : "Guest links require Team or higher"}
        >
          {freeBeta ? (
            <>
              New guest links are not offered with the Community plan during free beta, and paid upgrades are
              unavailable. You can still inspect signed manufacturing evidence and download repository-owned GitHub
              Actions artifacts while your GitHub access and their retention permit. These are not guest deliveries or
              fabrication approval.
              <div className="mt-3">
                <Button asChild variant="outline">
                  <Link href="/runs">Review signed Run archives</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              Your workspace can still inspect revisions and existing deliveries, but its current plan does not include
              creating new guest links.
            </>
          )}
        </Alert>
      </Panel>
    );
  }

  if (validatedRevisions.length === 0) {
    return (
      <Panel id="share-package" title="Share a package">
        <Alert tone="info" title="No run-backed revisions to share yet">
          A passing readiness run or runner-generated draft archive cannot be shared directly. A manufacturing export
          needs an accepted runner result and a stored archive before an owner or admin can authorize a guest link.
          Existing runs remain available to inspect; they do not grant delivery eligibility.
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
      description="Only authorized run-backed revisions can be selected. Source-to-export attestation is separate; the link is shown once."
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
        description="Guest links require an accepted passing runner result, a stored manufacturing archive and owner/admin sharing authorization."
      >
        <p className="text-sm text-muted-foreground">
          Creating a workspace or running readiness checks does not approve fabrication or issue a guest link. The
          standard runner's draft archive is not delivery-eligible; an accepted runner result with a stored
          manufacturing archive and explicit owner/admin permission are required.
        </p>
        <Button asChild className="mt-4">
          <Link href="/projects">Set up a CAD workspace</Link>
        </Button>
      </Panel>
    </section>
  );
}
