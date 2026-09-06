"use client";

import { Avatar as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Avatar({ className, ...props }: Readonly<ComponentProps<typeof Primitive.Root>>) {
  return (
    <Primitive.Root
      data-slot="avatar"
      className={cn("relative flex size-7 shrink-0 overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: Readonly<ComponentProps<typeof Primitive.Image>>) {
  return <Primitive.Image data-slot="avatar-image" className={cn("aspect-square size-full", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: Readonly<ComponentProps<typeof Primitive.Fallback>>) {
  return (
    <Primitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center text-micro font-semibold uppercase text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}
