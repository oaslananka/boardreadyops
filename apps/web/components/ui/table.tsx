import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

/**
 * Presentational table chrome only. `DataTable` composes these; pages that need bespoke cell
 * layout can use them directly and still match.
 *
 * The wrapper scrolls rather than the page, which is what keeps the 375px audit viewport free of
 * horizontal overflow.
 */
export function Table({
  className,
  scrollLabel,
  ...props
}: Readonly<ComponentProps<"table"> & { scrollLabel?: string }>) {
  return (
    // A scrollable box has to be reachable by keyboard, or someone who cannot use a pointer can
    // never see the columns that overflow (axe: scrollable-region-focusable).
    <section
      className="w-full overflow-x-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: axe requires a scrollable region to be keyboard-reachable
      tabIndex={0}
      aria-label={scrollLabel ?? "Scrollable table"}
    >
      <table data-slot="table" className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} />
    </section>
  );
}

export function TableHeader({ className, ...props }: Readonly<ComponentProps<"thead">>) {
  return <thead data-slot="table-header" className={cn("bg-muted", className)} {...props} />;
}

export function TableBody({ className, ...props }: Readonly<ComponentProps<"tbody">>) {
  return <tbody data-slot="table-body" className={cn("divide-y divide-border", className)} {...props} />;
}

export function TableRow({ className, ...props }: Readonly<ComponentProps<"tr">>) {
  return <tr data-slot="table-row" className={cn("transition-colors hover:bg-muted/60", className)} {...props} />;
}

export function TableHead({ className, ...props }: Readonly<ComponentProps<"th">>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "border-b border-border-strong px-3 py-2 text-left text-micro font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  asChild = false,
  ...props
}: Readonly<ComponentProps<"td"> & { asChild?: boolean }>) {
  // `asChild` exists so a row-label column can render `<th scope="row">` and still pick up the
  // cell chrome, rather than every caller re-deriving the padding.
  const Comp = asChild ? Slot.Root : "td";
  return <Comp data-slot="table-cell" className={cn("px-3 py-2.5 align-top text-foreground", className)} {...props} />;
}

export function TableCaption({ className, ...props }: Readonly<ComponentProps<"caption">>) {
  return <caption data-slot="table-caption" className={cn("sr-only", className)} {...props} />;
}
