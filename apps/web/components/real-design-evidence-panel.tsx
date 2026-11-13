import Image from "next/image";
import Link from "next/link";
import type { ViewerDesignEvidence } from "../lib/repository-dashboard.js";

export function RealDesignEvidencePanel({ evidence }: Readonly<{ evidence: ViewerDesignEvidence }>) {
  return (
    <section
      aria-labelledby="real-design-evidence-heading"
      className="grid min-w-0 gap-5 rounded-xl border border-primary/30 bg-card p-5 shadow-e1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      {evidence.hasNativePcb || evidence.hasNativeSchematic ? (
        <section className="grid min-w-0 grid-cols-2 gap-3" aria-label="Actual source-bound KiCad design previews">
          {(
            [
              ...(evidence.hasNativePcb ? [{ kind: "pcb", label: "PCB · F.Cu" }] : []),
              ...(evidence.hasNativeSchematic ? [{ kind: "schematic", label: "Schematic · KiCad" }] : []),
            ] as const
          ).map((view) => (
            <Link
              key={view.kind}
              href={`/runs/${evidence.runId}/design`}
              className="group min-w-0 overflow-hidden rounded-lg border border-border bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-950 p-1">
                {/* The separate authenticated endpoint serves one bounded native plot;
                    source SVG bytes never enter the dashboard HTML or JS props. */}
                <Image
                  unoptimized
                  width={720}
                  height={540}
                  src={`/runs/${evidence.runId}/preview?kind=${view.kind}`}
                  alt={`${view.label} — recorded source-derived KiCad artwork, not a manufacturing approval`}
                  className="max-h-full max-w-full object-contain transition-transform group-hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="px-2 py-2 text-xs font-medium text-foreground">{view.label} · Inspect</div>
            </Link>
          ))}
        </section>
      ) : null}
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
        <Link
          href={`/runs/${evidence.runId}/design`}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Inspect real design →
        </Link>
      </div>
    </section>
  );
}
