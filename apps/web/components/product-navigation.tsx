"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { BrandMarkLockup } from "./brand-mark.js";
import { ProductIcon, type ProductIconName } from "./product-icons.js";

type NavigationItem = Readonly<{
  href: string;
  icon: ProductIconName;
  label: string;
}>;

const groups: ReadonlyArray<Readonly<{ label: string; items: readonly NavigationItem[] }>> = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "projects" },
      { label: "My Work", href: "/work", icon: "work" },
    ],
  },
  {
    label: "Engineering",
    items: [{ label: "Reviews", href: "/reviews", icon: "reviews" }],
  },
  {
    label: "Governance",
    items: [
      { label: "Policies", href: "/policies", icon: "policies" },
      { label: "Evidence", href: "/evidence", icon: "evidence" },
      { label: "Insights", href: "/insights", icon: "insights" },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Setup", href: "/setup", icon: "setup" },
      { label: "Settings", href: "/settings/billing", icon: "settings" },
    ],
  },
] as const;

const COMPACT_STORAGE_KEY = "boardreadyops.product-nav.compact";

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

  return (
    <>
      <button
        ref={menuButtonRef}
        className="product-mobile-trigger"
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
          className="product-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        id="product-navigation-drawer"
        className="product-rail"
        data-compact={compact}
        data-mobile-open={mobileOpen}
      >
        <Link className="product-brand" href="/" aria-label="BoardReadyOps home">
          <BrandMarkLockup size={25} className="brand-lockup" />
        </Link>

        <nav className="product-navigation" aria-label="Product navigation">
          {groups.map((group, groupIndex) => (
            <section className="product-nav-group" key={group.label} aria-labelledby={`nav-${group.label}`}>
              <h2 id={`nav-${group.label}`}>{group.label}</h2>
              <ul>
                {group.items.map((item, itemIndex) => {
                  const current = isCurrentRoute(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        ref={groupIndex === 0 && itemIndex === 0 ? firstLinkRef : undefined}
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        title={compact ? item.label : undefined}
                        onClick={() => setMobileOpen(false)}
                      >
                        <ProductIcon name={item.icon} />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className="product-rail-footer">
          <a href="https://docs.boardreadyops.com" target="_blank" rel="noreferrer">
            <ProductIcon name="docs" />
            <span>Docs</span>
          </a>
          {viewerNav ? <Suspense fallback={null}>{viewerNav}</Suspense> : null}
          <div className="product-rail-actions">
            <button
              className="product-compact-toggle"
              type="button"
              aria-label={compact ? "Expand navigation" : "Collapse navigation"}
              title={compact ? "Expand navigation" : "Collapse navigation"}
              onClick={toggleCompact}
            >
              <ProductIcon name="menu" />
              <span>{compact ? "Expand" : "Collapse"}</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
