import Link from "next/link";

/**
 * These static PNG previews were rasterized from native KiCad SVGs plotted locally from the Zaptrace QA engineering
 * examples. They are illustrations, never an approved customer Review.
 */
export function ReviewEmptyVisualPreview() {
  return (
    <section
      aria-label="Example PCB and schematic design views"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">A visual hardware review</p>
          <h2 className="mt-1 text-xl font-bold text-foreground">See the design, not just a report</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Explore PCB copper and schematic views alongside findings when you publish a Review with native KiCad
            snapshots.
          </p>
        </div>
        <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
          Example only
        </span>
      </header>
      <div className="grid min-w-0 gap-3 p-3 sm:p-4 lg:grid-cols-2">
        <figure className="min-w-0 overflow-hidden rounded-lg border border-border bg-[#0b1220]">
          <div className="flex items-center justify-between gap-3 border-b border-white/15 px-3 py-2 text-white">
            <figcaption className="text-xs font-semibold">PCB · copper &amp; components</figcaption>
            <span className="text-[11px] text-white/65">Native KiCad plot</span>
          </div>
          {/* biome-ignore lint/performance/noImgElement: Static render of the first-party sample KiCad plot. */}
          <img
            src="/demo/zaptrace-sample-pcb.png"
            alt="Example KiCad PCB drawing with copper traces, pads and connectors"
            className="h-60 w-full object-contain p-3 sm:h-72"
          />
        </figure>
        <figure className="min-w-0 overflow-hidden rounded-lg border border-border bg-[#faf9f5]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-slate-800">
            <figcaption className="text-xs font-semibold">Schematic · nets &amp; symbols</figcaption>
            <span className="text-[11px] text-slate-500">Native KiCad plot</span>
          </div>
          {/* biome-ignore lint/performance/noImgElement: Static render of the first-party sample KiCad plot. */}
          <img
            src="/demo/zaptrace-sample-schematic.png"
            alt="Example KiCad schematic with ESP32, I2C components and net labels"
            className="h-60 w-full object-contain p-3 sm:h-72"
          />
        </figure>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-6">
        <p className="max-w-xl text-xs text-muted-foreground">
          Sample designs, not your repository, not recorded findings or manufacturing approval.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
          <Link href="/runs" className="text-primary underline-offset-4 hover:underline">
            Browse your runs →
          </Link>
          <Link href="/reviews#publish-review" className="text-primary underline-offset-4 hover:underline">
            Publish your first Review →
          </Link>
        </div>
      </footer>
    </section>
  );
}
