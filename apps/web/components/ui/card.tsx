import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Card({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-md border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: Readonly<ComponentProps<"h2">>) {
  return <h2 data-slot="card-title" className={cn("text-base font-bold leading-none", className)} {...props} />;
}

export function CardDescription({ className, ...props }: Readonly<ComponentProps<"p">>) {
  return <p data-slot="card-description" className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}

export function CardAction({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return <div data-slot="card-action" className={cn("flex items-center gap-2", className)} {...props} />;
}

export function CardContent({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return <div data-slot="card-content" className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return <div data-slot="card-footer" className={cn("border-t border-border px-5 py-4", className)} {...props} />;
}
