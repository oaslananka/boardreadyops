"use client";

import { type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  titleId,
  onClose,
  panelClassName,
  children,
}: {
  readonly titleId: string;
  readonly onClose: () => void;
  readonly panelClassName?: string;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  // role="dialog" + aria-modal, not native <dialog>: this is the same WAI-ARIA
  // pattern react-aria/Radix/Headless UI use, and it's what the audit that
  // requested this component explicitly asked for. Native <dialog> would need
  // a parallel CSS rewrite (::backdrop instead of .modal-backdrop) and its
  // showModal()-driven focus/Escape/inert behavior isn't reproducible in this
  // repo's happy-dom test environment (verified: showModal() doesn't move
  // focus or fire "cancel" on Escape there), so it can't be covered by tests --
  // not worth the blast radius for a marginal gain over the already-correct
  // and fully-tested handling below.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        className={
          panelClassName ??
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        }
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
