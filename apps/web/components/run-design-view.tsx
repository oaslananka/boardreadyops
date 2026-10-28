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
  return (
    <section aria-label="Run design inspection" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">PCB & schematic inspection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Visual evidence published for this exact run, not a generic product illustration.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border border-border px-2 py-1">{snapshots.length} published views</span>
          <span className="rounded-md border border-border px-2 py-1">{native} KiCad-native</span>
          {baseSnapshots.length > 0 ? (
            <span className="rounded-md border border-border px-2 py-1">{baseSnapshots.length} base views</span>
          ) : null}
        </div>
      </div>
      {snapshots.length ? (
        <>
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
            {native
              ? "KiCad-native artwork shows source-derived design geometry. Other views may be summary diagrams."
              : "These are schematic/PCB summaries, not complete native KiCad design geometry."}{" "}
            {baseSnapshots.length > 0
              ? "Base/head comparison is a visual overlay, not a dimensional or electrical verification. "
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
