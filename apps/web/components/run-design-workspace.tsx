"use client";

import type { SnapshotArtifact } from "@boardreadyops/contracts";
import { useState } from "react";
import { findingGuidance, githubFindingSourceUrl, recordedVirtualBomNotice } from "../lib/finding-guidance.js";
import type { RunDetail } from "../lib/run-dashboard.js";
import { ReviewCanvas } from "./review/review-canvas.js";

type RunFinding = RunDetail["findings"][number];

/** Presentation priority only: never suppress or rewrite historical findings. */
function findingReviewPriority(finding: RunFinding, linkedFingerprints: ReadonlySet<string>): number {
  if (finding.fingerprint && linkedFingerprints.has(finding.fingerprint)) return 0;
  if (recordedVirtualBomNotice(finding.ruleId, finding.message)) return 2;
  return 1;
}

/** Use the same source-grounded finding details in the mobile row and desktop inspector. */
function FindingEvidence({
  finding,
  sourceUrl,
  sourceLabel,
  recordedAnchor,
}: Readonly<{
  finding: RunFinding;
  sourceUrl: string | undefined;
  sourceLabel: string;
  recordedAnchor: boolean;
}>) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-xs text-muted-foreground">Rule</span>
        <p className="mt-1 break-words font-medium text-foreground">{finding.ruleId}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">Source at evaluated commit</span>
        <p className="mt-1 break-all text-foreground">
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {finding.path} ↗
            </a>
          ) : (
            sourceLabel
          )}
        </p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">How to investigate</span>
        <p className="mt-1 text-foreground">{findingGuidance(finding.ruleId, finding.message)}</p>
      </div>
      <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
        {recordedAnchor
          ? "This finding has a recorded image anchor. Confirm the design location against the native source."
          : "No verified image coordinate is linked to this finding. Use the source and diagnostic instead."}
      </p>
    </div>
  );
}

/**
 * A run is evidence, not an approved Review. Only a recorded snapshot anchor with
 * the same persisted finding fingerprint may select a visual location; rule text and
 * component names are never converted into guessed coordinates.
 */
export function RunDesignWorkspace({
  snapshots,
  baseSnapshots = [],
  findings,
  totalFindings,
  repository,
  commitSha,
}: Readonly<{
  snapshots: SnapshotArtifact[];
  baseSnapshots?: SnapshotArtifact[];
  findings: RunFinding[];
  totalFindings: number;
  repository: string;
  commitSha: string;
}>) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // A run snapshot may contain findings from another results page, or stale
  // fingerprints. Do not display clickable locations without exactly one
  // matching finding on the page currently visible to this viewer.
  const fingerprintCounts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.fingerprint) {
      fingerprintCounts.set(finding.fingerprint, (fingerprintCounts.get(finding.fingerprint) ?? 0) + 1);
    }
  }
  const visibleFingerprints = new Set(
    [...fingerprintCounts].filter(([, count]) => count === 1).map(([fingerprint]) => fingerprint),
  );
  const visibleSnapshots = snapshots.map((snapshot) => ({
    ...snapshot,
    anchors: snapshot.anchors.filter(
      (anchor) =>
        anchor.kind !== "finding" ||
        (typeof anchor.metadata?.fingerprint === "string" &&
          visibleFingerprints.has(anchor.metadata.fingerprint) &&
          Number.isFinite(anchor.x) &&
          Number.isFinite(anchor.y) &&
          anchor.x >= 0 &&
          anchor.x <= 1 &&
          anchor.y >= 0 &&
          anchor.y <= 1),
    ),
  }));
  // Only source-linked markers that survived the same uniqueness/coordinate
  // checks as the canvas get visual priority. Other physical findings follow,
  // with historical virtual BOM warnings still visible last on this page.
  const linkedFingerprints = new Set<string>();
  for (const snapshot of visibleSnapshots) {
    for (const anchor of snapshot.anchors) {
      if (anchor.kind === "finding" && typeof anchor.metadata?.fingerprint === "string") {
        linkedFingerprints.add(anchor.metadata.fingerprint);
      }
    }
  }
  const orderedFindings = [...findings].sort(
    (a, b) => findingReviewPriority(a, linkedFingerprints) - findingReviewPriority(b, linkedFingerprints),
  );
  const selected = orderedFindings.find((finding) => finding.id === selectedId) ?? orderedFindings[0];
  const activeSelectedId = selected?.id;
  const selectedFingerprint =
    selected?.fingerprint && visibleFingerprints.has(selected.fingerprint) ? selected.fingerprint : undefined;
  const recordedAnchor = Boolean(
    selectedFingerprint &&
      visibleSnapshots.some((snapshot) =>
        snapshot.anchors.some(
          (anchor) => anchor.kind === "finding" && anchor.metadata?.fingerprint === selectedFingerprint,
        ),
      ),
  );
  const sourceUrl = selected ? githubFindingSourceUrl(repository, commitSha, selected.path) : undefined;
  const sourceLabel = selected?.path && selected.path !== "." ? selected.path : "Repository-level finding";

  return (
    <section
      className="grid min-w-0 gap-3 xl:grid-cols-[minmax(265px,1.05fr)_minmax(0,1.9fr)_minmax(235px,0.95fr)]"
      aria-label="Run design investigation workspace"
    >
      <aside className="order-2 min-w-0 rounded-lg border border-border bg-card p-3 xl:order-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Recorded findings</h3>
          <span className="text-xs text-muted-foreground">
            {findings.length} of {totalFindings}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Verified markers first; legacy virtual BOM references last on this page. All severities remain unchanged.
        </p>
        {findings.length > 0 ? (
          <ul className="mt-3 flex max-h-[34rem] flex-col gap-2 overflow-y-auto">
            {orderedFindings.map((finding) => (
              <li key={finding.id}>
                <button
                  type="button"
                  aria-pressed={activeSelectedId === finding.id}
                  onClick={() => setSelectedId(finding.id)}
                  className={
                    "w-full rounded-md border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                    (activeSelectedId === finding.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:border-primary/60")
                  }
                >
                  <span className="block text-xs font-semibold text-primary">
                    {finding.severity.toUpperCase()} · {finding.ruleId}
                  </span>
                  <span className="mt-1 line-clamp-2 block break-words text-sm text-foreground">{finding.message}</span>
                  {recordedVirtualBomNotice(finding.ruleId, finding.message) ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {recordedVirtualBomNotice(finding.ruleId, finding.message)}
                    </span>
                  ) : null}
                  {finding.waivedAt ? (
                    <span className="mt-1 block text-xs text-muted-foreground">Waived · remains recorded</span>
                  ) : null}
                </button>
                {activeSelectedId === finding.id && selected ? (
                  <section
                    aria-label="Selected finding details"
                    className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3 xl:hidden"
                  >
                    <FindingEvidence
                      finding={selected}
                      sourceUrl={sourceUrl}
                      sourceLabel={sourceLabel}
                      recordedAnchor={recordedAnchor}
                    />
                  </section>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No findings are recorded in this page. This does not independently establish fabrication readiness.
          </p>
        )}
      </aside>

      <div className="order-1 min-w-0 xl:order-2">
        <ReviewCanvas
          headSnapshots={visibleSnapshots}
          baseSnapshots={baseSnapshots}
          compactMobile
          {...(recordedAnchor ? { selectedFindingFingerprint: selectedFingerprint } : {})}
          onSelectFinding={(fingerprint) => {
            // A snapshot may contain anchors outside the current findings page. Only
            // one exact persisted fingerprint may select a finding; otherwise ignore.
            const matching = findings.filter((finding) => finding.fingerprint && finding.fingerprint === fingerprint);
            if (matching.length === 1 && matching[0]) setSelectedId(matching[0].id);
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Artwork belongs to this run. Only markers linked to a unique finding on this page are shown. Never infer a
          physical defect location from a finding message.
        </p>
      </div>

      <aside
        className="order-3 hidden min-w-0 rounded-lg border border-border bg-card p-3 xl:block"
        aria-label="Selected run finding"
      >
        <h3 className="text-sm font-semibold text-foreground">Finding inspector</h3>
        {selected ? (
          <div className="mt-3">
            <FindingEvidence
              finding={selected}
              sourceUrl={sourceUrl}
              sourceLabel={sourceLabel}
              recordedAnchor={recordedAnchor}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Select a finding to inspect its source and guidance.</p>
        )}
      </aside>
    </section>
  );
}
