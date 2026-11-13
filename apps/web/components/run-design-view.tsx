import type { SnapshotArtifact } from "@boardreadyops/contracts";
import Link from "next/link";
import type { RunDetail } from "../lib/run-dashboard.js";
import { RunDesignWorkspace } from "./run-design-workspace.js";
import { Pagination } from "./ui.js";

/** Never direct a self-hosted user's private PCB artwork to a different service. */
export function trustedReviewServerOrigin(configured?: string): string | undefined {
  if (!configured || !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/?$/u.test(configured)) {
    return undefined;
  }
  try {
    const parsed = new URL(configured);
    return parsed.hostname && !parsed.hostname.startsWith("-") ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export function RunDesignView({
  runId,
  snapshots,
  baseSnapshots = [],
  reviewId,
  findings = [],
  findingsPage,
  totalFindings = 0,
  repository = "",
  commitSha = "",
  serverOrigin,
}: Readonly<{
  runId: string;
  snapshots: SnapshotArtifact[];
  baseSnapshots?: SnapshotArtifact[];
  reviewId?: string;
  findings?: RunDetail["findings"];
  findingsPage?: Pick<RunDetail["findingsPage"], "page" | "totalPages">;
  totalFindings?: number;
  repository?: string;
  commitSha?: string;
  serverOrigin?: string | undefined;
}>) {
  const publishServer = trustedReviewServerOrigin(serverOrigin);
  const native = snapshots.filter((item) => item.name.startsWith("kicad_native_")).length;
  const baseNative = baseSnapshots.filter((item) => item.name.startsWith("kicad_native_")).length;
  const hasHeadArtwork = snapshots.length > 0;
  const hasBaseArtwork = baseSnapshots.length > 0;
  return (
    <section aria-label="Run design inspection" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">PCB & schematic inspection</h2>
          <p
            className={
              hasHeadArtwork ? "mt-1 text-xs text-muted-foreground sm:text-sm" : "mt-1 text-sm text-muted-foreground"
            }
          >
            {hasHeadArtwork
              ? "Real run artwork · not fabrication approval."
              : hasBaseArtwork
                ? "Only the recorded base revision has design artwork; this run has no published head views."
                : "No visual evidence was published for this run."}
          </p>
        </div>
      </div>
      {hasHeadArtwork || hasBaseArtwork ? (
        <>
          {!hasHeadArtwork ? (
            <div
              role="status"
              className="rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-foreground"
            >
              <p className="font-semibold">No head-revision PCB or schematic snapshot was published for this run.</p>
              <p className="mt-1 text-muted-foreground">
                Showing recorded base-revision artwork only. This does not show the board at the current run commit,
                prove that any layer was deleted, or enable a trustworthy base/head comparison.
              </p>
              <Link
                href="/reviews#publish-review"
                className="mt-2 inline-flex min-h-10 items-center text-primary underline"
              >
                How to publish current-run visuals →
              </Link>
            </div>
          ) : null}
          <RunDesignWorkspace
            // A new findings page must reset the selected row and its marker.
            key={findingsPage?.page ?? 1}
            snapshots={snapshots}
            baseSnapshots={baseSnapshots}
            findings={findings}
            totalFindings={totalFindings}
            repository={repository}
            commitSha={commitSha}
          />
          {findingsPage && findingsPage.totalPages > 1 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Only findings on the current page can be selected in the artwork. Switch pages to investigate the
                remaining recorded findings.
              </p>
              <Pagination
                basePath={`/runs/${encodeURIComponent(runId)}/design`}
                page={findingsPage.page}
                totalPages={findingsPage.totalPages}
                pageParameter="findingsPage"
                searchParameters={{}}
              />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {hasHeadArtwork
              ? native
                ? "KiCad-native artwork shows source-derived design geometry. Other views may be summary diagrams."
                : "These are schematic/PCB summaries, not complete native KiCad design geometry."
              : "These images belong only to the recorded base revision, not the current run."}{" "}
            {hasHeadArtwork && hasBaseArtwork
              ? "Base/head comparison is a visual overlay only where both revisions publish matching layer artwork; it is not a dimensional or electrical verification. "
              : hasBaseArtwork
                ? "No head artwork is available for visual comparison. "
                : "No exact-commit base images are available for comparison. "}
            Finding coordinates are not inferred from these pictures and the drawings do not certify manufacturing
            readiness.
          </p>
        </>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center">
          <h3 className="text-base font-semibold">No PCB or schematic preview published for this run</h3>
          <p className="max-w-xl text-sm text-muted-foreground">
            This run has no visual snapshots. An authorized publisher can attach design summaries through Review
            publishing. Native KiCad artwork requires the explicit --native-visuals option because it may disclose
            proprietary PCB and schematic details.
          </p>
          {totalFindings > 0 ? (
            <Link
              href={`/runs/${encodeURIComponent(runId)}/findings#finding-results`}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Investigate {totalFindings} recorded findings →
            </Link>
          ) : null}
          <details className="w-full max-w-2xl rounded-lg border border-border bg-background p-4 text-left">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-primary">
              Publish source-derived PCB and schematic views
            </summary>
            <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
              <li>
                Check out the exact KiCad design you intend to publish and commit your changes. Verify{" "}
                <code>git rev-parse HEAD</code>
                {commitSha && /^[0-9a-f]{40}$/u.test(commitSha) ? (
                  <>
                    {" "}
                    against this run&apos;s commit <code className="break-all">{commitSha}</code>
                  </>
                ) : (
                  <> against the source revision you intend to publish</>
                )}
                .
              </li>
              <li>
                Configure a repository-scoped <code>BOARDREADYOPS_TOKEN</code> with <code>runs:write</code>. Native
                artwork discloses PCB and schematic geometry. It is not uploaded without <code>--native-visuals</code>.
              </li>
              <li>
                Publish from the authorized local project:
                <code className="mt-2 block max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-foreground">
                  {publishServer
                    ? `boardreadyops review publish . --native-visuals --server ${publishServer}`
                    : "boardreadyops review publish . --native-visuals --server https://YOUR-BOARDREADYOPS-SERVER"}
                </code>
                <span className="mt-2 block text-xs">
                  {publishServer
                    ? "Verify this is the intended server before uploading your private design. "
                    : "Replace YOUR-BOARDREADYOPS-SERVER with your actual instance origin before running. "}
                  If the repository contains multiple boards, add <code>--project path/to/board.kicad_pro</code> to
                  restrict which design is uploaded.
                </span>
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              This publishes a separate source-bound run and Review. It does not attach images to this earlier run,
              approve a board or certify manufacturing readiness.
            </p>
            <Link
              href="/reviews#publish-review"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline"
            >
              Review publishing requirements →
            </Link>
          </details>
        </div>
      )}
      <section
        aria-label="Published artwork inventory"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <span className="rounded-md border border-border px-2 py-1">{snapshots.length} published views</span>
        <span className="rounded-md border border-border px-2 py-1">{native} KiCad-native</span>
        {hasBaseArtwork ? (
          <>
            <span className="rounded-md border border-border px-2 py-1">{baseSnapshots.length} base views</span>
            {baseNative > 0 ? (
              <span className="rounded-md border border-border px-2 py-1">{baseNative} base KiCad-native</span>
            ) : null}
          </>
        ) : null}
      </section>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/runs/${encodeURIComponent(runId)}/findings`}
          className="text-primary underline underline-offset-4"
        >
          Examine recorded findings
        </Link>
        {reviewId ? (
          <Link href={`/reviews/${encodeURIComponent(reviewId)}`} className="text-primary underline underline-offset-4">
            Open published Review
          </Link>
        ) : null}
      </div>
    </section>
  );
}
