import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
import { controlClassName } from "./field.js";

export function Input({ className, type = "text", ...props }: Readonly<ComponentProps<"input">>) {
  // `className` must merge rather than replace: `input.assignee-input` and friends are
  // element-plus-class selectors the E2E suite binds to.
  return <input data-slot="input" type={type} className={cn(controlClassName, "h-9 py-1", className)} {...props} />;
}
