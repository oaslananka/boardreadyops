import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

const alertVariants = cva(
  // `1fr` is `minmax(auto, 1fr)`, so the text track refuses to shrink below its content's
  // min-content width and one long unbroken token -- an MPN, a digest, a credential id -- widens
  // the whole page. `minmax(0, 1fr)` lets it shrink; the children wrap instead.
  "relative grid grid-cols-[0_minmax(0,1fr)] gap-1 rounded-md border px-4 py-3 has-[svg]:grid-cols-[1.25rem_minmax(0,1fr)] has-[svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        danger: "border-danger/40 bg-danger-surface text-danger [&>svg]:text-danger",
        success: "border-success/40 bg-success-surface text-success [&>svg]:text-success",
        warning: "border-warning/40 bg-warning-surface text-warning [&>svg]:text-warning",
        info: "border-info/40 bg-info-surface text-info [&>svg]:text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function AlertRoot({
  className,
  variant,
  ...props
}: Readonly<ComponentProps<"div"> & VariantProps<typeof alertVariants>>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 min-w-0 break-words font-medium leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="alert-description"
      className={cn("col-start-2 min-w-0 break-words text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
