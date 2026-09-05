"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.js";
import { BrandMarkLockup } from "./brand-mark.js";
import { ProductIcon, type ProductIconName } from "./product-icons.js";
import { ThemeToggle } from "./theme-toggle.js";

type NavigationItem = Readonly<{
  href: string;
  icon: ProductIconName;
  label: string;
}>;

const groups: ReadonlyArray<Readonly<{ label: string; items: readonly NavigationItem[] }>> = [
  {
    label: "1. Get a board in",
    items: [
      { label: "Projects", href: "/projects", icon: "projects" },
      { label: "Setup", href: "/setup", icon: "setup" },
    ],
  },
  {
    label: "2. Work the findings",
    items: [
      { label: "My Work", href: "/work", icon: "work" },
      { label: "Reviews", href: "/reviews", icon: "reviews" },
    ],
  },
  {
    label: "3. Ship it",
    items: [
      { label: "Deliveries", href: "/deliveries", icon: "deliveries" },
      { label: "Parts", href: "/parts", icon: "parts" },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Policies", href: "/policies", icon: "policies" },
      { label: "Evidence", href: "/evidence", icon: "evidence" },
      { label: "Insights", href: "/insights", icon: "insights" },
    ],
  },
  {
    label: "Workspace",
    items: [{ label: "Settings", href: "/settings/billing", icon: "settings" }],
  },
] as const;

const COMPACT_STORAGE_KEY = "boardreadyops.product-nav.compact";

// Group labels like "1. Get a board in" contain spaces and punctuation that are invalid
// in an HTML id, so derive a slug for the id/aria-labelledby pair instead of using the
// label verbatim.
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isCurrentRoute(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === "/settings/billing") return pathname.startsWith("/settings/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProductNavigation({ viewerNav }: Readonly<{ viewerNav?: ReactNode }>) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const wasMobileOpen = useRef(false);

  useEffect(() => {
    if (mobileOpen) {
      wasMobileOpen.current = true;
      document.body.style.overflow = "hidden";
      firstLinkRef.current?.focus();
    } else {
      document.body.style.overflow = "";
      if (wasMobileOpen.current) menuButtonRef.current?.focus();
      wasMobileOpen.current = false;
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setMobileOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  // Read the persisted collapse state after mount rather than during initial
  // render, so server and first client render both start expanded (no
  // hydration mismatch) and only then adopt whatever the viewer chose last.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COMPACT_STORAGE_KEY) === "true") setCompact(true);
    } catch {
      // Storage may be unavailable (private browsing, disabled cookies); collapse just won't persist.
    }
  }, []);

  function toggleCompact() {
    setCompact((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COMPACT_STORAGE_KEY, String(next));
      } catch {
        // Non-fatal: navigation still toggles for this session even if it can't be remembered.
      }
      return next;
    });
  }

  const dashboardCurrent = isCurrentRoute(pathname, "/dashboard");

  return (
    <>
      <button
        ref={menuButtonRef}
        className="fixed left-4 top-4 z-40 flex size-10 items-center justify-center rounded-md border border-border bg-card md:hidden"
        type="button"
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        aria-controls="product-navigation-drawer"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <ProductIcon name={mobileOpen ? "close" : "menu"} />
      </button>

      {mobileOpen ? (
        <button
          className="fixed inset-0 z-30 bg-background/80 md:hidden"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        id="product-navigation-drawer"
        className={cn(
          // `product-rail` carries no styling any more (its styles.css rules are gone) -- it is kept
          // as a stable selector hook for tests/e2e/regression-audit-findings.spec.ts.
          "product-rail fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border bg-card transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0",
          compact && "md:w-16",
          !mobileOpen && "-translate-x-full md:translate-x-0",
        )}
        data-compact={compact}
        data-mobile-open={mobileOpen}
      >
        <Link
          className="flex items-center gap-2 border-b border-border px-4 py-4"
          href="/"
          aria-label="BoardReadyOps home"
        >
          <BrandMarkLockup size={25} className="shrink-0" />
        </Link>

        <nav aria-label="Product navigation" className="flex-1 overflow-y-auto px-2 py-3">
          <Link
            ref={firstLinkRef}
            href="/dashboard"
            aria-current={dashboardCurrent ? "page" : undefined}
            title={compact ? "Dashboard" : undefined}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "mb-3 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-bold",
              dashboardCurrent ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/10",
            )}
          >
            <ProductIcon name="projects" />
            {!compact && <span>Dashboard</span>}
          </Link>

          {groups.map((group) => (
            <section key={group.label} aria-labelledby={`nav-${slugify(group.label)}`} className="mb-4">
              {!compact && (
                <h2
                  id={`nav-${slugify(group.label)}`}
                  className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const current = isCurrentRoute(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        title={compact ? item.label : undefined}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                          current ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-accent/10",
                        )}
                      >
                        <ProductIcon name={item.icon} />
                        {!compact && <span>{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-border px-2.5 py-3">
          <a
            href="https://docs.boardreadyops.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-accent/10"
          >
            <ProductIcon name="docs" />
            {!compact && <span>Docs</span>}
          </a>
          {!compact && <ThemeToggle />}
          {viewerNav ? <Suspense fallback={null}>{viewerNav}</Suspense> : null}
          <button
            type="button"
            aria-label={compact ? "Expand navigation" : "Collapse navigation"}
            title={compact ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleCompact}
            // `product-compact-toggle` is an unstyled selector hook for the e2e regression spec.
            className="product-compact-toggle flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/10"
          >
            <ProductIcon name="menu" />
            {!compact && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
