import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { CopyButton } from "../../components/copy-button.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Alert, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import {
  loadPartsInventory,
  type PartInventoryEntry,
  type PartLifecycle,
  parsePartLifecycle,
} from "../../lib/parts-inventory.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata: Metadata = {
  title: "Component Intelligence & Parts",
  description: "Aggregated BOM component risk, distributor inventory, and lifecycle statuses.",
};

// Scoped to the viewer's installations and filtered from the URL, so it can never be prerendered.
export const dynamic = "force-dynamic";

export type PartsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A part with no observation is not the same as one observed to be fine, and the page must not
 * imply otherwise -- "unobserved" means nobody has looked, which on this page is a gap in
 * coverage rather than reassurance.
 */
const lifecycleLabels: Record<PartLifecycle, string> = {
  active: "Active",
  nrnd: "Not recommended",
  eol: "End of life",
  obsolete: "Obsolete",
  unknown: "Unknown",
  unobserved: "Not checked",
};

/** Maps to the status palette so risk reads the same here as everywhere else in the product. */
const lifecycleTone: Record<PartLifecycle, string> = {
  active: "success",
  nrnd: "warning",
  eol: "danger",
  obsolete: "danger",
  unknown: "neutral",
  unobserved: "neutral",
};

function when(value: string | undefined): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().slice(0, 10);
}

const columns: readonly DataColumn<PartInventoryEntry>[] = [
  {
    id: "part",
    header: "Part",
    rowHeader: true,
    cell: (part) => (
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="font-mono break-all">{part.mpn}</span>
          <CopyButton value={part.mpn} label="Copy MPN" />
        </span>
        <span className="text-meta text-muted-foreground">{part.manufacturer ?? "Manufacturer not recorded"}</span>
      </span>
    ),
  },
  {
    id: "lifecycle",
    header: "Lifecycle",
    cell: (part) => (
      <span className="flex flex-col gap-0.5">
        <StatusBadge value={lifecycleTone[part.lifecycle]} label={lifecycleLabels[part.lifecycle]} />
        <span className="text-meta text-muted-foreground">
          {part.lifecycle === "unobserved"
            ? "No source consulted"
            : `${part.lifecycleSource ?? "unknown source"} · ${when(part.lifecycleObservedAt)}`}
        </span>
      </span>
    ),
  },
  {
    id: "boards",
    header: "Used on",
    cell: (part) => (
      <span className="flex flex-col gap-0.5">
        <span className="tabular-nums">
          {part.boardCount} {part.boardCount === 1 ? "board" : "boards"}
        </span>
        <span className="text-meta text-muted-foreground break-words">
          {part.boardNames.join(", ")}
          {part.boardCount > part.boardNames.length ? ` +${part.boardCount - part.boardNames.length} more` : ""}
        </span>
      </span>
    ),
  },
  {
    id: "quantity",
    header: "Qty",
    align: "end",
    cell: (part) => <span className="tabular-nums">{part.totalQuantity}</span>,
  },
  {
    id: "findings",
    header: "Open findings",
    align: "end",
    cell: (part) =>
      part.openFindingCount === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="flex items-center justify-end gap-1.5">
          <span className="tabular-nums">{part.openFindingCount}</span>
          {part.worstSeverity ? <StatusBadge value={part.worstSeverity} /> : null}
        </span>
      ),
  },
];

export default async function PartsPage({ searchParams }: Readonly<PartsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();

  const query = first(parameters.q)?.slice(0, 128);
  const lifecycle = parsePartLifecycle(first(parameters.lifecycle));
  const risk = first(parameters.risk) === "at-risk" ? ("at-risk" as const) : undefined;

  const inventory = await loadPartsInventory(viewer.session, {
    ...(query ? { query } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(risk ? { risk } : {}),
  });

  const parts = inventory.state === "ok" ? inventory.parts : [];
  const unidentified = inventory.state === "ok" ? inventory.unidentifiedComponentCount : 0;
  const filtered = Boolean(query || lifecycle || risk);

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Parts" }]}>
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Component Intelligence &amp; Parts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every part on the current bill of materials of the boards you can see, with its lifecycle status and any
            open supply findings. Riskiest first.
          </p>
        </header>

        {unidentified > 0 ? (
          <Alert tone="info" title={`${unidentified} components have no part number`}>
            They cannot be matched against a lifecycle source, so they are not listed below. A BOM that names
            manufacturer part numbers is what makes the rest of this page possible.
          </Alert>
        ) : null}

        <Panel
          title="Parts in current use"
          description="Only each board's latest snapshot counts, so a part removed in a later revision drops off."
        >
          {/* A plain GET form: filtering works without JavaScript, and the resulting URL is the
              shareable thing an engineer pastes into a ticket. */}
          <form method="get" action="/parts" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Search</span>
              <Input name="q" type="search" maxLength={128} defaultValue={query} placeholder="MPN or manufacturer" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Lifecycle</span>
              <NativeSelect name="lifecycle" defaultValue={lifecycle ?? ""}>
                <option value="">Any</option>
                <option value="active">Active</option>
                <option value="nrnd">Not recommended</option>
                <option value="eol">End of life</option>
                <option value="obsolete">Obsolete</option>
                <option value="unknown">Unknown</option>
                <option value="unobserved">Not checked</option>
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Risk</span>
              <NativeSelect name="risk" defaultValue={risk ?? ""}>
                <option value="">All parts</option>
                <option value="at-risk">At risk only</option>
              </NativeSelect>
            </label>
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {filtered ? (
              <Button asChild variant="ghost">
                <Link href="/parts">Clear</Link>
              </Button>
            ) : null}
          </form>

          <DataTable
            caption="Parts on current bills of materials, riskiest first"
            columns={columns}
            rows={parts}
            rowKey={(part) => part.key}
            empty={<PartsEmptyState state={inventory.state} filtered={filtered} />}
          />
        </Panel>
      </main>
    </AppShell>
  );
}

function PartsEmptyState({
  state,
  filtered,
}: Readonly<{ state: "signed-out" | "not-configured" | "ok"; filtered: boolean }>) {
  if (state === "signed-out") {
    return (
      <EmptyState title="Sign in to see your parts">
        <p>Parts are aggregated from the boards your GitHub App installations can access.</p>
        <Button asChild className="mt-3">
          <a href="/api/auth/github/login">Sign in with GitHub</a>
        </Button>
      </EmptyState>
    );
  }

  if (state === "not-configured") {
    return (
      <EmptyState title="Component intelligence is not configured">
        <p>This deployment has no control-plane database, so no bills of materials have been captured.</p>
      </EmptyState>
    );
  }

  // A filtered-to-empty result is not the same as having no parts at all, and telling someone to
  // go and link a repository when they have simply over-filtered would be wrong.
  if (filtered) {
    return (
      <EmptyState title="No parts match these filters">
        <p>Widen the search, or clear the filters to see every part on your current bills of materials.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/parts">Clear filters</Link>
        </Button>
      </EmptyState>
    );
  }

  return (
    <GuidedChecklist
      heading="Populate your component intelligence"
      steps={[
        {
          id: "setup",
          label: "Link a repository with a hardware project",
          status: "current",
          href: "/setup",
          actionLabel: "Go to Setup",
        },
        {
          id: "ingest",
          label: "Ingest a manufacturing package or BOM file to populate parts automatically",
          status: "upcoming",
        },
      ]}
    />
  );
}
