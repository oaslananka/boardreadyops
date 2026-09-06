import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
import { controlClassName } from "./field.js";

export function Textarea({ className, ...props }: Readonly<ComponentProps<"textarea">>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClassName, "min-h-16 field-sizing-content", className)}
      {...props}
    />
  );
}
