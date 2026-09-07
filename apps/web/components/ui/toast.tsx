"use client";

import { Toast as Primitive } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useId, useMemo, useState } from "react";
import { cn } from "../../lib/utils.js";

export type ToastTone = "success" | "danger" | "info";

export type ToastInput = {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  /** Milliseconds before auto-dismiss. Errors stay until dismissed. */
  readonly duration?: number;
};

type ToastRecord = ToastInput & { readonly id: string };

type ToastApi = {
  readonly toast: (input: ToastInput) => void;
  readonly success: (title: string, description?: string) => void;
  readonly error: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const toneClassName: Record<ToastTone, string> = {
  success: "border-success/40 bg-success-surface text-success",
  danger: "border-danger/40 bg-danger-surface text-danger",
  info: "border-border bg-popover text-popover-foreground",
};

/**
 * Replaces the pair of inline "role=alert" / "<output>" banners that were duplicated verbatim in
 * three components and never dismissed.
 *
 * Radix rather than `sonner`: `radix-ui` is already a dependency and already listed in knip's
 * ignoreDependencies, so this costs no lockfile, NOTICE, or licence churn.
 */
export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [items, setItems] = useState<readonly ToastRecord[]>([]);
  const baseId = useId();

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const push = (input: ToastInput) => {
      setItems((current) => [...current, { ...input, id: `${baseId}-${current.length}-${Date.now()}` }]);
    };
    return {
      toast: push,
      success: (title, description) => push({ title, ...(description ? { description } : {}), tone: "success" }),
      // Errors do not auto-dismiss: the user needs time to read what failed.
      error: (title, description) =>
        push({ title, ...(description ? { description } : {}), tone: "danger", duration: Number.POSITIVE_INFINITY }),
    };
  }, [baseId]);

  return (
    <ToastContext.Provider value={api}>
      <Primitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <Primitive.Root
            key={item.id}
            data-slot="toast"
            {...(item.duration === undefined ? {} : { duration: item.duration })}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className={cn(
              "flex items-start gap-3 rounded-md border px-4 py-3 shadow-e3",
              "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-4",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
              toneClassName[item.tone ?? "info"],
            )}
          >
            <div className="flex-1">
              <Primitive.Title className="text-sm font-semibold">{item.title}</Primitive.Title>
              {item.description ? (
                <Primitive.Description className="mt-0.5 text-meta opacity-90">
                  {item.description}
                </Primitive.Description>
              ) : null}
            </div>
            <Primitive.Close
              aria-label="Dismiss notification"
              className="rounded-sm px-1 text-current opacity-70 outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              ✕
            </Primitive.Close>
          </Primitive.Root>
        ))}
        <Primitive.Viewport className="fixed bottom-4 right-4 z-100 flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </Primitive.Provider>
    </ToastContext.Provider>
  );
}

/**
 * Throws outside a provider on purpose. A mutation that silently loses its only success/failure
 * feedback is worse than a crash in development.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
