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

    // Lock the page behind the modal and take it out of the accessibility tree. Without this the
    // background scrolls under the overlay and a screen reader can still walk into it -- the two
    // real gaps in this component's otherwise complete WAI-ARIA handling.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // This dialog renders inline rather than through a portal, so "everything else" is every
    // sibling on the path from the backdrop up to <body> -- not just the top-level children.
    // Inerting an ancestor instead would inert the dialog with it.
    const inerted: Element[] = [];
    for (let node = panel?.parentElement; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling !== node && !sibling.hasAttribute("inert")) inerted.push(sibling);
      }
    }
    for (const element of inerted) element.setAttribute("inert", "");

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
      document.body.style.overflow = previousOverflow;
      for (const element of inerted) element.removeAttribute("inert");
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        className={
          panelClassName ??
          "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-popover shadow-e3"
        }
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
