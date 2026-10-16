"use client";

import { useState } from "react";
import type { DemoFinding, DemoReview } from "../../lib/demo-data.js";
import { ReviewCanvas } from "./review-canvas.js";

const severityOrder: Record<DemoFinding["severity"], number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

function isBlocking(finding: DemoFinding): boolean {
  return finding.disposition === "open" && (finding.severity === "critical" || finding.severity === "error");
}

function isLinkedInSnapshot(review: DemoReview, fingerprint: string): boolean {
  return Boolean(
    review.headSnapshots?.some((snapshot) =>
      snapshot.anchors.some((anchor) => anchor.kind === "finding" && anchor.metadata?.fingerprint === fingerprint),
    ),
  );
}

/**
 * Zaptrace's three-pane engineering review adapted to BoardReadyOps's published
 * snapshots and findings. A summary SVG is not exact native KiCad geometry.
 */
export function ReviewDesignWorkspace({ review }: Readonly<{ review: DemoReview }>) {
  const findings = [...review.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | undefined>(findings[0]?.fingerprint);
  const selected = findings.find((finding) => finding.fingerprint === selectedFingerprint);
  const blocking = findings.filter(isBlocking).length;
  const snapshots = review.headSnapshots ?? [];
  const nativeViews = snapshots.filter((snapshot) => snapshot.name.startsWith("kicad_native_")).length;
  const optionalBaseSnapshots = review.baseSnapshots ? { baseSnapshots: review.baseSnapshots } : {};

  return (
    <section aria-label="Hardware design inspection workspace" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Hardware design review</p>
          <h2 className="text-lg font-semibold text-foreground">See the evidence, then decide</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-danger-surface px-2 py-1 font-semibold text-danger">
            {blocking} open critical/error
          </span>
          <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
            {snapshots.length} published views
          </span>
          <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
            Decision: {review.decision.replaceAll("_", " ")}
          </span>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(190px,0.8fr)_minmax(0,2.4fr)_minmax(220px,1fr)]">
        <div className="order-2 min-w-0 rounded-lg border border-border bg-card p-3 xl:order-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Findings</h3>
            <span className="text-xs text-muted-foreground">{findings.length} recorded</span>
          </div>
          {findings.length ? (
            <div className="mt-3 flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
              {findings.map((finding) => {
                const active = finding.fingerprint === selectedFingerprint;
                return (
                  <button
                    key={finding.fingerprint}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedFingerprint(finding.fingerprint)}
                    className={
                      "w-full min-w-0 rounded-md border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                      (active ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50")
                    }
                  >
                    <span
                      className={[
                        "block text-xs font-semibold",
                        isBlocking(finding) ? "text-danger" : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {finding.severity.toUpperCase()} · {finding.ruleId}
                    </span>
                    <span className="mt-1 block text-sm text-foreground">{finding.message}</span>
                    <span
                      className={
                        "mt-2 block text-xs " +
                        (isLinkedInSnapshot(review, finding.fingerprint) ? "text-primary" : "text-muted-foreground")
                      }
                    >
                      {isLinkedInSnapshot(review, finding.fingerprint)
                        ? "Snapshot marker available"
                        : "No snapshot marker"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No findings are recorded for this Review. This does not independently verify manufacturing readiness.
            </p>
          )}
        </div>

        <div className="order-1 min-w-0 space-y-2 xl:order-2">
          {snapshots.length ? (
            <>
              <ReviewCanvas
                headSnapshots={snapshots}
                {...optionalBaseSnapshots}
                findings={review.findings}
                comments={review.comments}
                selectedFindingFingerprint={selectedFingerprint}
                onSelectFinding={setSelectedFingerprint}
              />
              <p className="text-xs text-muted-foreground">
                {nativeViews > 0
                  ? String(nativeViews) +
                    " view(s) plotted by the local KiCad exporter; other views, if present, are summaries. Native artwork does not attest to manufacturing readiness. Finding locations are only shown when independently linked."
                  : "Published review snapshots are component/layer summaries, not exact native KiCad copper or schematic geometry. A marker indicates a linked reference, not verified physical fault coordinates or fabrication approval."}
              </p>
            </>
          ) : (
            <div className="flex min-h-[25rem] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center">
              <p className="text-base font-semibold text-foreground">
                No schematic or PCB snapshot is available for this revision.
              </p>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Publish a Review with snapshots from an authorized KiCad run to inspect its design here. Recorded
                findings remain available without claiming an image exists.
              </p>
            </div>
          )}
        </div>

        <aside
          aria-label="Selected finding inspector"
          className="order-3 min-w-0 rounded-lg border border-border bg-card p-3"
        >
          <h3 className="text-sm font-semibold text-foreground">Inspector</h3>
          {selected ? (
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Selected finding</dt>
                <dd className="mt-1 break-words font-medium">{selected.ruleId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Engineering detail</dt>
                <dd className="mt-1 break-words">{selected.message}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source reference</dt>
                <dd className="mt-1 break-all">{selected.component ?? selected.path}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Disposition</dt>
                <dd className="mt-1">{selected.disposition.replaceAll("_", " ")}</dd>
              </div>
              <div className="rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
                {isLinkedInSnapshot(review, selected.fingerprint)
                  ? "Reference mapped in a published summary snapshot; verify location in native KiCad."
                  : "No verified image location is available for this finding. Inspect its source path and native KiCad evidence."}
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Select a finding to inspect its recorded evidence.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
