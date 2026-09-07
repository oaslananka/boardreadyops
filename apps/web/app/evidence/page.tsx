import Link from "next/link";
import { CopyButton } from "../../components/copy-button.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { AppShell, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { type EvidenceLedgerEntry, loadEvidenceLedger } from "../../lib/evidence-ledger.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Releases & Evidence",
  description: "Signed evidence packs bound to review decisions, approvals and artifact digests.",
};

// Scoped to the viewer's installations, so it can never be prerendered.
export const dynamic = "force-dynamic";

function when(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

const columns: readonly DataColumn<EvidenceLedgerEntry>[] = [
  {
    id: "review",
    header: "Review",
    rowHeader: true,
    cell: (entry) => (
      <span className="flex flex-col gap-0.5">
        <Link href={`/reviews/${entry.reviewId}`} className="text-primary hover:underline">
          {entry.reviewTitle}
        </Link>
        <span className="text-meta text-muted-foreground">
          {entry.repositoryName}
          {entry.pullRequestNumber === undefined ? "" : ` · PR #${entry.pullRequestNumber}`}
        </span>
      </span>
    ),
  },
  {
    id: "revision",
    header: "Revision",
    cell: (entry) => <span className="tabular-nums">#{entry.sequence}</span>,
  },
  {
    id: "commit",
    header: "Head commit",
    cell: (entry) => (
      <span className="flex items-center gap-1.5">
        <span className="font-mono">{entry.headCommitSha.slice(0, 7)}</span>
        <CopyButton value={entry.headCommitSha} label="Copy commit SHA" />
      </span>
    ),
  },
  {
    id: "digest",
    header: "Evidence digest",
    cell: (entry) => (
      <span className="flex items-center gap-1.5">
        {/* Twelve characters, not seven: this is what someone eyeballs against `release verify`
            output, and a SHA-256 prefix needs more than a git short hash to be worth comparing. */}
        <span className="font-mono">{entry.evidenceDigest.slice(0, 12)}</span>
        <CopyButton value={entry.evidenceDigest} label="Copy evidence digest" />
      </span>
    ),
  },
  {
    id: "decision",
    header: "Decision",
    cell: (entry) => <StatusBadge value={entry.decision} />,
  },
  {
    id: "recorded",
    header: "Recorded",
    align: "end",
    // <time> is masked in the visual baselines, so a new revision does not churn a screenshot.
    cell: (entry) => (
      <time dateTime={entry.createdAt} className="text-muted-foreground tabular-nums">
        {when(entry.createdAt)}
      </time>
    ),
  },
];

export default async function EvidencePage() {
  const viewer = await viewerAuthorization();
  const ledger = await loadEvidenceLedger(viewer.session);
  const entries = ledger.state === "ok" ? ledger.entries : [];

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Evidence" }]}
    >
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Releases &amp; Evidence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every revision recorded against a review, with the evidence digest that pins it. Each digest is
            deterministic and can be recomputed from the pack without this service.
          </p>
        </header>

        <Panel title="Evidence ledger" description="Newest first, across every repository your installations can see.">
          <DataTable
            caption="Evidence digests by review revision"
            columns={columns}
            rows={entries}
            rowKey={(entry) => entry.revisionId}
            empty={<LedgerEmptyState state={ledger.state} />}
          />
        </Panel>

        <Panel
          title="Verify offline"
          description="The digests above are reproducible; nothing here has to be trusted on our word."
        >
          <p className="text-sm text-foreground">
            An evidence pack records base and head SHAs, tool versions, artifact digests and the decision history.
            Recompute the ledger from a downloaded pack and compare the digest:
          </p>
          {/* A scrollable block needs keyboard access, or its overflow is unreachable without a pointer. */}
          <pre
            className="mt-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: axe requires a scrollable region to be keyboard-reachable
            tabIndex={0}
          >
            boardreadyops release verify --ledger ./evidence-ledger.json
          </pre>
        </Panel>
      </main>
    </AppShell>
  );
}

/**
 * Three states worth distinguishing: not signed in, no database, and genuinely empty. Collapsing
 * them into one "nothing here" message is what made the old page unable to say anything true.
 */
function LedgerEmptyState({ state }: Readonly<{ state: "signed-out" | "not-configured" | "ok" }>) {
  if (state === "signed-out") {
    return (
      <EmptyState title="Sign in to see your evidence ledger">
        <p>Evidence is scoped to the repositories your GitHub App installations can access.</p>
        <Button asChild className="mt-3">
          <a href="/api/auth/github/login">Sign in with GitHub</a>
        </Button>
      </EmptyState>
    );
  }

  if (state === "not-configured") {
    return (
      <EmptyState title="Evidence storage is not configured">
        <p>
          This deployment has no control-plane database, so there is no ledger to read. Evidence packs produced by a run
          can still be verified offline with the command below.
        </p>
      </EmptyState>
    );
  }

  return (
    <EmptyState title="No evidence recorded yet">
      <p>
        A revision is recorded the first time a review is opened against a readiness run. Open a pull request on a
        linked repository to produce one.
      </p>
      <Button asChild variant="outline" className="mt-3">
        <Link href="/reviews">Go to Reviews</Link>
      </Button>
    </EmptyState>
  );
}
