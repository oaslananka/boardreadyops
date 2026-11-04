import Link from "next/link";

/**
 * The images are exported from the same open-source RoyalBlue54L Feather KiCad design.
 * They are demonstrations, never recorded customer Review evidence.
 */
export function ReviewEmptyVisualPreview({
  mode = "reviews",
  actionHref = "/setup",
  actionLabel = "Connect a repository",
}: Readonly<{
  mode?: "onboarding" | "reviews";
  actionHref?: string;
  actionLabel?: string;
}> = {}) {
  const onboarding = mode === "onboarding";
  const actionClassName =
    "inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90";
  const onboardingAction =
    actionHref === "/api/auth/github/login" ? (
      // OAuth starts with a server redirect, not an App Router client navigation.
      <a href={actionHref} className={actionClassName}>
        {actionLabel} →
      </a>
    ) : (
      <Link href={actionHref} className={actionClassName}>
        {actionLabel} →
      </Link>
    );
  return (
    <section
      aria-label="Example PCB and schematic design views"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">A visual hardware review</p>
          <h2 className="mt-1 text-xl font-bold text-foreground">
            {onboarding ? "Your next hardware review starts with the board" : "See the design, not just a report"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {onboarding
              ? "See what a visual PCB and schematic review looks like, then connect your own design to get real, commit-bound findings."
              : "Explore PCB copper and schematic views alongside findings when you publish a Review with native KiCad snapshots."}
          </p>
        </div>
        <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
          Example only
        </span>
      </header>
      <div className="grid min-w-0 gap-4 p-4 sm:p-6 xl:grid-cols-2">
        <figure className="group min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-foreground">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Board layout</p>
              <figcaption className="mt-1 text-sm font-semibold">PCB · assembled board</figcaption>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
              KiCad sample
            </span>
          </div>
          <a
            href="/demo/royalblue54l-pcb.webp"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open full-resolution example PCB plot"
            className="relative block overflow-hidden bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          >
            {/* biome-ignore lint/performance/noImgElement: Source-faithful native KiCad sample plot. */}
            <img
              src="/demo/royalblue54l-pcb.webp"
              alt="KiCad 3D rendering of RoyalBlue54L Feather board with assembled chips, USB connector and contact pads"
              loading="lazy"
              decoding="async"
              className="h-64 w-full object-contain object-center transition-transform duration-300 motion-safe:group-hover:scale-[1.08] sm:h-80 sm:object-cover"
            />
            <span className="absolute bottom-3 right-3 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm">
              Full view ↗
            </span>
          </a>
          <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Genuine KiCad 3D render, not customer data or a verified manufacturing release.
          </p>
        </figure>
        <figure className="group min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-foreground">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Circuit logic</p>
              <figcaption className="mt-1 text-sm font-semibold">Schematic · MCU and nets</figcaption>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
              KiCad sample
            </span>
          </div>
          <a
            href="/demo/royalblue54l-schematic.webp"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open full-resolution example schematic plot"
            className="relative block overflow-hidden bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          >
            {/* biome-ignore lint/performance/noImgElement: Source-faithful native KiCad sample plot. */}
            <img
              src="/demo/royalblue54l-schematic.webp"
              alt="Cropped KiCad schematic of RoyalBlue54L nRF54L15 microcontroller, components and circuit nets"
              loading="lazy"
              decoding="async"
              className="h-64 w-full object-contain object-center transition-transform duration-300 motion-safe:group-hover:scale-[1.08] sm:h-80 sm:object-cover"
            />
            <span className="absolute bottom-3 right-3 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm">
              Full view ↗
            </span>
          </a>
          <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Native KiCad export cropped for legibility; circuit symbols and nets are unchanged.
          </p>
        </figure>
      </div>
      <p className="px-4 pb-4 text-xs leading-relaxed text-muted-foreground sm:px-6">
        Image source:{" "}
        <a
          href="https://github.com/LordsBoards/RoyalBlue54L-Feather-Hardware"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-4 hover:text-foreground"
        >
          RoyalBlue54L Feather by LordsBoards
        </a>{" "}
        (CERN-OHL-P-2.0). Cropped native KiCad renders, not customer evidence or manufacturing approval.
      </p>
      {onboarding ? (
        <ol
          className="grid gap-3 px-4 pb-4 text-sm sm:grid-cols-3 sm:px-6"
          aria-label="From design to production review"
        >
          <li className="rounded-lg border border-border bg-muted/25 p-3">
            <span className="text-xs font-semibold text-primary">See the design</span>
            <p className="mt-1 text-foreground">PCB, schematic and source revision.</p>
          </li>
          <li className="rounded-lg border border-border bg-muted/25 p-3">
            <span className="text-xs font-semibold text-primary">Investigate blockers</span>
            <p className="mt-1 text-foreground">Findings tied to recorded evidence.</p>
          </li>
          <li className="rounded-lg border border-border bg-muted/25 p-3">
            <span className="text-xs font-semibold text-primary">Prepare the handoff</span>
            <p className="mt-1 text-foreground">Verify the package before fabrication.</p>
          </li>
        </ol>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-6">
        <p className="max-w-xl text-xs text-muted-foreground">
          Sample designs, not your repository, not recorded findings or manufacturing approval.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
          {onboarding ? (
            onboardingAction
          ) : (
            <Link href="/reviews#publish-review" className="text-primary underline-offset-4 hover:underline">
              Publish your first Review →
            </Link>
          )}
          <Link href="/runs" className="text-primary underline-offset-4 hover:underline">
            Browse your runs →
          </Link>
        </div>
      </footer>
    </section>
  );
}
