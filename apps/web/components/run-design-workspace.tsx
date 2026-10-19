"use client";

import type { SnapshotArtifact } from "@boardreadyops/contracts";
import { useState } from "react";
import { findingGuidance, githubFindingSourceUrl } from "../lib/finding-guidance.js";
import type { RunDetail } from "../lib/run-dashboard.js";
import { ReviewCanvas } from "./review/review-canvas.js";

type RunFinding = RunDetail["findings"][number];

/**
 * A run is evidence, not an approved Review. Only a recorded snapshot anchor with
 * the same persisted finding identity may select a visual location; rule text and
 * component names are never converted into guessed coordinates.
 */
export function RunDesignWorkspace({
  snapshots,
  findings,
  totalFindings,
  repository,
  commitSha,
}: Readonly<{
  snapshots: SnapshotArtifact[];
  findings: RunFinding[];
  totalFindings: number;
  repository: string;
  commitSha: string;
}>) {
  const [selectedId, setSelectedId] = useState<string | undefined>(findings[0]?.id);
  const selected = findings.find((finding) => finding.id === selectedId);
  const recordedAnchor = selected
    ? snapshots.some((snapshot) =>
        snapshot.anchors.some((anchor) => anchor.kind === "finding" && anchor.metadata?.fingerprint === selected.id),
      )
    : false;
  const sourceUrl = selected ? githubFindingSourceUrl(repository, commitSha, selected.path) : undefined;
  const sourceLabel = selected?.path && selected.path !== "." ? selected.path : "Repository-level finding";

  return (
    <section
      className="grid min-w-0 gap-3 xl:grid-cols-[minmax(210px,0.9fr)_minmax(0,2.15fr)_minmax(210px,0.95fr)]"
      aria-label="Run design investigation workspace"
    >
      <aside className="order-2 min-w-0 rounded-lg border border-border bg-card p-3 xl:order-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Recorded findings</h3>
          <span className="text-xs text-muted-foreground">
            {findings.length} of {totalFindings}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Select an issue to inspect its verified source evidence.</p>
        {findings.length > 0 ? (
          <ul className="mt-3 flex max-h-[34rem] flex-col gap-2 overflow-y-auto">
            {findings.map((finding) => (
              <li key={finding.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === finding.id}
                  onClick={() => setSelectedId(finding.id)}
                  className={
                    "w-full rounded-md border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                    (selectedId === finding.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:border-primary/60")
                  }
                >
                  <span className="block text-xs font-semibold text-primary">
                    {finding.severity.toUpperCase()} · {finding.ruleId}
                  </span>
                  <span className="mt-1 block break-words text-sm text-foreground">{finding.message}</span>
                  {finding.waivedAt ? (
                    <span className="mt-1 block text-xs text-muted-foreground">Waived · remains recorded</span>
                  ) : null}
                </button>
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
          headSnapshots={snapshots}
          {...(recordedAnchor ? { selectedFindingFingerprint: selectedId } : {})}
          onSelectFinding={(fingerprint) => {
            // A snapshot may contain markers with identities not present in this run's
            // currently loaded finding page. Never fabricate a link in that case.
            if (findings.some((finding) => finding.id === fingerprint)) setSelectedId(fingerprint);
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Artwork belongs to this run. A highlighted location requires an explicit, matching recorded anchor; never
          infer a physical defect location from a finding message.
        </p>
      </div>

      <aside className="order-3 min-w-0 rounded-lg border border-border bg-card p-3" aria-label="Selected run finding">
        <h3 className="text-sm font-semibold text-foreground">Finding inspector</h3>
        {selected ? (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Rule</span>
              <p className="mt-1 break-words font-medium text-foreground">{selected.ruleId}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Source at evaluated commit</span>
              <p className="mt-1 break-all text-foreground">
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    {selected.path} ↗
                  </a>
                ) : (
                  sourceLabel
                )}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">How to investigate</span>
              <p className="mt-1 text-foreground">{findingGuidance(selected.ruleId, selected.message)}</p>
            </div>
            <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
              {recordedAnchor
                ? "This finding has a recorded image anchor. Confirm the design location against the native source."
                : "No verified image coordinate is linked to this finding. Use the source and diagnostic instead."}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Select a finding to inspect its source and guidance.</p>
        )}
      </aside>
    </section>
  );
}
