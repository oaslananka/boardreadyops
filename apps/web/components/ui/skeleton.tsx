import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

/**
 * A placeholder block. Always size these to the real content's geometry rather than using a
 * spinner, so the page does not reflow when data arrives.
 *
 * Route-level `loading.tsx` files mark their own container `aria-busy`; individual skeletons are
 * decorative and hidden from assistive tech.
 */
export function Skeleton({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-secondary", className)}
      {...props}
    />
  );
}
