import type { SnapshotArtifact } from "@boardreadyops/contracts";
import Link from "next/link";
import type { RunDetail } from "../lib/run-dashboard.js";
import { RunDesignWorkspace } from "./run-design-workspace.js";
import { Pagination } from "./ui.js";

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
}>) {
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
          <Link
            href="/reviews#publish-review"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2"
          >
            How to publish a Review →
          </Link>
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
