import Link from "next/link";
import type { ViewerDesignEvidence } from "../lib/repository-dashboard.js";

export function RealDesignEvidencePanel({ evidence }: Readonly<{ evidence: ViewerDesignEvidence }>) {
  return (
    <section
      aria-labelledby="real-design-evidence-heading"
      className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-5 shadow-e1 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Real recorded design evidence</p>
        <h2 id="real-design-evidence-heading" className="font-display text-xl font-semibold text-foreground">
          {evidence.hasPcb && evidence.hasSchematic
            ? "Explore your actual PCB and schematic evidence"
            : evidence.hasPcb
              ? "Explore your recorded PCB evidence"
              : "Explore your recorded schematic evidence"}
        </h2>
        <p className="break-words text-sm font-medium text-foreground">{evidence.repository}</p>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {evidence.hasPcb ? (
            <span className="rounded-md border border-border px-2 py-1">PCB layer published</span>
          ) : null}
          {evidence.hasSchematic ? (
            <span className="rounded-md border border-border px-2 py-1">Schematic published</span>
          ) : null}
        </div>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Published artwork from the latest recorded run for this repository, not a sample or a signed manufacturing
          clearance. Open the evidence to inspect the source revision and any missing or unverified results.
        </p>
      </div>
      <Link
        href={`/runs/${evidence.runId}/design`}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Inspect real design →
      </Link>
    </section>
  );
}
