"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils.js";
import { navigationDestinations } from "../navigation-model.js";
import { ProductIcon, type ProductIconName } from "../product-icons.js";

export type CommandItem = {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly icon?: ProductIconName;
  readonly hint?: string;
  /** Destinations are real links so middle-click, copy-link, and prefetch all work. */
  readonly href?: string;
  /** Actions that are not navigation. Exactly one of `href` or `run` is set. */
  readonly run?: () => void;
};

/**
 * Renders the keyboard shortcut for the *viewer's* platform, filled in after mount.
 *
 * Two reasons it is client-only. It stops Windows and Linux users being shown a Mac glyph, and
 * it keeps the server markup free of "⌘" — which `tests/unit/web/app-shell.test.ts` asserts,
 * because the assertion was written against a hint for a shortcut that did not exist. The
 * shortcut exists now; the ban on advertising one that doesn't is still worth keeping.
 */
function Keycap() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
    setLabel(mac ? "⌘K" : "Ctrl K");
  }, []);
  return (
    <kbd
      data-keycap
      suppressHydrationWarning
      className="hidden min-w-10 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground sm:inline-block"
    >
      {label}
    </kbd>
  );
}

export function CommandPalette({ extraItems = [] }: Readonly<{ extraItems?: readonly CommandItem[] }>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { setTheme, resolvedTheme } = useTheme();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLElement | null)[]>([]);

  const items = useMemo<readonly CommandItem[]>(() => {
    const destinations = navigationDestinations.map<CommandItem>((destination) => ({
      id: `go:${destination.href}`,
      label: destination.label,
      group: destination.group,
      icon: destination.icon,
      hint: destination.href,
      href: destination.href,
    }));
    const actions: CommandItem[] = [
      {
        id: "action:theme",
        label: resolvedTheme === "light" ? "Switch to dark theme" : "Switch to light theme",
        group: "Actions",
        run: () => setTheme(resolvedTheme === "light" ? "dark" : "light"),
      },
      {
        id: "action:docs",
        label: "Open documentation",
        group: "Actions",
        hint: "docs.boardreadyops.com",
        run: () => window.open("https://docs.boardreadyops.com", "_blank", "noreferrer"),
      },
    ];
    return [...destinations, ...extraItems, ...actions];
  }, [setTheme, resolvedTheme, extraItems]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) => item.label.toLowerCase().includes(needle) || item.group.toLowerCase().includes(needle),
    );
  }, [items, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable === true;
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      // "/" is the other conventional opener, but only when the viewer is not already typing.
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (matches.length === 0 ? 0 : (index + 1) % matches.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (matches.length === 0 ? 0 : (index - 1 + matches.length) % matches.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Click the real element rather than routing by hand: destinations are <Link>s, so this
      // keeps one navigation path and needs no router instance (which also makes the palette
      // renderable in the static-markup unit tests).
      optionRefs.current[active]?.click();
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
        setActive(0);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-command-trigger
          aria-label="Search"
          aria-keyshortcuts="Meta+K Control+K"
          // Icon-only below sm so the topbar still fits a 375px viewport; the label and keycap
          // appear once there is room for them.
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background text-sm text-muted-foreground outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-full sm:max-w-80 sm:justify-start sm:px-3 md:min-h-9"
        >
          <ProductIcon name="reviews" />
          <span className="hidden flex-1 text-left sm:inline">Search</span>
          <Keycap />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed left-1/2 top-24 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-e3 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Search destinations and commands"
            placeholder="Jump to a page or run a command..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="w-full border-b border-border bg-transparent px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <ul id={listId} aria-label="Results" className="max-h-80 overflow-y-auto p-1.5">
            {matches.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches for “{query}”</li>
            ) : (
              matches.map((item, index) => {
                const className = cn(
                  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm outline-none",
                  index === active ? "bg-accent text-accent-foreground" : "text-foreground",
                );
                const content = (
                  <>
                    {item.icon ? <ProductIcon name={item.icon} /> : <span className="size-4" aria-hidden="true" />}
                    <span className="flex-1">{item.label}</span>
                    <span className="text-micro text-muted-foreground">{item.hint ?? item.group}</span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        ref={(node) => {
                          optionRefs.current[index] = node;
                        }}
                        href={item.href}
                        aria-current={index === active ? "true" : undefined}
                        onMouseEnter={() => setActive(index)}
                        onClick={close}
                        className={className}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        ref={(node) => {
                          optionRefs.current[index] = node;
                        }}
                        type="button"
                        aria-current={index === active ? "true" : undefined}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => {
                          close();
                          item.run?.();
                        }}
                        className={className}
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
