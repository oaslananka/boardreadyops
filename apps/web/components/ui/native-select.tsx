import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
import { controlClassName } from "./field.js";

/**
 * A styled native `<select>`, not Radix's.
 *
 * Radix renders a button plus a portalled listbox; the E2E suite pins `select.disposition-select`
 * and `select.triage-severity-select` as *element* selectors, and native selects are also the
 * better mobile control. So this stays native and only carries the chrome.
 */
export function NativeSelect({ className, children, ...props }: Readonly<ComponentProps<"select">>) {
  return (
    <select
      data-slot="native-select"
      className={cn(controlClassName, "h-9 cursor-pointer py-1 pr-8", className)}
      {...props}
    >
      {children}
    </select>
  );
}
