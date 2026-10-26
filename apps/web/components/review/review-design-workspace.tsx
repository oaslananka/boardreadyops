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

type FindingFilter = "blocking" | "all";

export function visibleReviewFindings(findings: readonly DemoFinding[], filter: FindingFilter, query: string) {
  const search = query.trim().toLowerCase();
  return findings.filter((finding) => {
    if (filter === "blocking" && !isBlocking(finding)) return false;
    if (!search) return true;
    return [finding.ruleId, finding.message, finding.component, finding.path].some((value) =>
      value?.toLowerCase().includes(search),
    );
  });
}

export function groupReviewFindings(findings: readonly DemoFinding[]): { ruleId: string; findings: DemoFinding[] }[] {
  const groups = new Map<string, DemoFinding[]>();
  for (const finding of findings) {
    const existing = groups.get(finding.ruleId);
    if (existing) existing.push(finding);
    else groups.set(finding.ruleId, [finding]);
  }
  return Array.from(groups, ([ruleId, entries]) => ({ ruleId, findings: entries }));
}

function hasNativeObjectPosition(review: DemoReview, fingerprint: string): boolean {
  return Boolean(
    review.headSnapshots?.some(
      (snapshot) =>
        snapshot.name.startsWith("kicad_native_") &&
        snapshot.anchors.some(
          (anchor) =>
            anchor.kind === "finding" &&
            anchor.metadata?.fingerprint === fingerprint &&
            anchor.metadata.provenance === "kicad-json-object-position",
        ),
    ),
  );
}

/**
 * Zaptrace's three-pane engineering review adapted to BoardReadyOps's published
 * snapshots and findings. A summary SVG is not exact native KiCad geometry.
 */
export function ReviewDesignWorkspace({ review }: Readonly<{ review: DemoReview }>) {
  const findings = [...review.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const blocking = findings.filter(isBlocking).length;
  const [filter, setFilter] = useState<FindingFilter>(blocking > 0 ? "blocking" : "all");
  const [query, setQuery] = useState("");
  const [focusCanvas, setFocusCanvas] = useState(false);
  const visibleFindings = visibleReviewFindings(findings, filter, query);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | undefined>(
    findings.find(isBlocking)?.fingerprint ?? findings[0]?.fingerprint,
  );
  const selected = visibleFindings.find((finding) => finding.fingerprint === selectedFingerprint) ?? visibleFindings[0];
  const snapshots = review.headSnapshots ?? [];
  const nativeViews = snapshots.filter((snapshot) => snapshot.name.startsWith("kicad_native_")).length;
  const optionalBaseSnapshots = review.baseSnapshots ? { baseSnapshots: review.baseSnapshots } : {};
  const selectCanvasFinding = (fingerprint: string) => {
    // A source-bound marker may point to a finding excluded by the current list filter.
    // Selecting a marker must also make its finding visible in the inspector.
    if (!visibleFindings.some((finding) => finding.fingerprint === fingerprint)) {
      setFilter("all");
      setQuery("");
    }
    setSelectedFingerprint(fingerprint);
  };

  const renderFindingButton = (finding: DemoFinding) => {
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
        <span className="mt-1 line-clamp-2 block break-words text-sm text-foreground">{finding.message}</span>
        <span
          className={
            "mt-2 block text-xs " +
            (isLinkedInSnapshot(review, finding.fingerprint) ? "text-primary" : "text-muted-foreground")
          }
        >
          {isLinkedInSnapshot(review, finding.fingerprint) ? "Snapshot marker available" : "No snapshot marker"}
        </span>
      </button>
    );
  };

  return (
    <section aria-label="Hardware design inspection workspace" className="space-y-3">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 sm:gap-3 sm:p-4">
        <div className="min-w-0">
          <p className="hidden text-xs font-semibold uppercase tracking-wide text-primary sm:block">
            Hardware design review
          </p>
          <h2 className="text-base font-semibold text-foreground sm:text-lg">See the evidence, then decide</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            aria-pressed={focusCanvas}
            aria-controls="review-evidence-canvas"
            onClick={() => setFocusCanvas((focused) => !focused)}
            className="inline-flex min-h-10 items-center rounded-md border border-primary/40 bg-primary/10 px-3 py-2 font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {focusCanvas ? "Show findings and inspector" : "Focus PCB / schematic"}
          </button>
          <span className="rounded-md bg-danger-surface px-2 py-1 font-semibold text-danger">
            {blocking} open critical/error
          </span>
          <span className="hidden rounded-md border border-border px-2 py-1 text-muted-foreground sm:inline">
            {snapshots.length} published views
          </span>
          <span className="hidden rounded-md border border-border px-2 py-1 text-muted-foreground sm:inline">
            Decision: {review.decision.replaceAll("_", " ")}
          </span>
        </div>
      </header>

      <div
        className={
          focusCanvas
            ? "grid min-w-0 grid-cols-1 gap-3"
            : "grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(245px,0.9fr)_minmax(0,3fr)_minmax(245px,0.9fr)]"
        }
      >
        <div
          className={focusCanvas ? "hidden" : "order-2 min-w-0 rounded-lg border border-border bg-card p-3 xl:order-1"}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Findings</h3>
            <span className="text-xs text-muted-foreground">{findings.length} recorded</span>
          </div>
          {findings.length ? (
            <>
              <div className="mt-3 space-y-2">
                <fieldset className="flex flex-wrap gap-1">
                  <legend className="sr-only">Finding severity filter</legend>
                  <button
                    type="button"
                    aria-pressed={filter === "blocking"}
                    className={`rounded-md border px-2.5 py-1.5 text-xs ${filter === "blocking" ? "border-danger text-danger" : "border-border text-muted-foreground"}`}
                    onClick={() => setFilter("blocking")}
                  >
                    Blockers ({blocking})
                  </button>
                  <button
                    type="button"
                    aria-pressed={filter === "all"}
                    className={`rounded-md border px-2.5 py-1.5 text-xs ${filter === "all" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                    onClick={() => setFilter("all")}
                  >
                    All ({findings.length})
                  </button>
                </fieldset>
                <label className="sr-only" htmlFor="review-finding-search">
                  Search findings by rule, component or message
                </label>
                <input
                  id="review-finding-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search rules, parts, messages"
                  className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground" role="status">
                  {visibleFindings.length} of {findings.length} findings shown
                </p>
              </div>
              <div className="mt-3 flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
                {groupReviewFindings(visibleFindings).map((group) => (
                  <div key={group.ruleId} className="flex flex-col gap-2">
                    {group.findings.length > 2 ? (
                      <h4 className="text-xs font-semibold text-muted-foreground">
                        {group.ruleId} · {group.findings.length} recorded findings
                      </h4>
                    ) : null}
                    {group.findings.slice(0, 2).map(renderFindingButton)}
                    {group.findings.length > 2 ? (
                      <details className="rounded-md border border-border p-2">
                        <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium text-primary">
                          Show {group.findings.length - 2} more {group.ruleId} findings
                        </summary>
                        <div className="flex flex-col gap-2 pt-2">
                          {group.findings.slice(2).map(renderFindingButton)}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))}
                {visibleFindings.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                    No findings match these filters. Switch to All or clear the search.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No findings are recorded for this Review. This does not independently verify manufacturing readiness.
            </p>
          )}
        </div>

        <div id="review-evidence-canvas" className="order-1 min-w-0 space-y-2 xl:order-2">
          {snapshots.length ? (
            <>
              <ReviewCanvas
                compactMobile
                immersive={focusCanvas}
                headSnapshots={snapshots}
                {...optionalBaseSnapshots}
                findings={review.findings}
                comments={review.comments}
                selectedFindingFingerprint={selectedFingerprint}
                onSelectFinding={selectCanvasFinding}
              />
              <p className="text-xs text-muted-foreground">
                {nativeViews > 0
                  ? String(nativeViews) +
                    " view(s) plotted by the local KiCad exporter; other views, if present, are summaries. Native artwork does not attest to manufacturing readiness. Finding locations are only shown when independently linked."
                  : "Published review snapshots are component/layer summaries, not exact native KiCad copper or schematic geometry. A marker indicates a linked reference, not verified physical fault coordinates or fabrication approval."}
              </p>
            </>
          ) : (
            <div className="flex min-h-[17rem] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center md:min-h-[25rem]">
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
          className={focusCanvas ? "hidden" : "order-3 min-w-0 rounded-lg border border-border bg-card p-3"}
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
                {hasNativeObjectPosition(review, selected.fingerprint)
                  ? "Marker identifies a source object recorded by KiCad DRC, not the exact violation geometry. Open KiCad to verify the fault."
                  : isLinkedInSnapshot(review, selected.fingerprint)
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
