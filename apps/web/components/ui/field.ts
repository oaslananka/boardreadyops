import { cn } from "../../lib/utils.js";

/**
 * Shared control chrome for `Input`, `Textarea`, and `NativeSelect`.
 *
 * Exported because a handful of call sites still render a bare element for reasons the E2E suite
 * depends on (see `NativeSelect`), and they should not drift from the styled ones.
 */
export const controlClassName = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-e1",
  "transition-[color,box-shadow,border-color] placeholder:text-muted-foreground",
  "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  "aria-invalid:border-danger aria-invalid:ring-danger/30",
  "disabled:cursor-not-allowed disabled:opacity-50",
);
