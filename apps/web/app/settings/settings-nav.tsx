"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { label: "Billing & Seats", href: "/settings/billing" },
  { label: "Security & Access", href: "/settings/security" },
  { label: "Data & Retention", href: "/settings/data" },
  { label: "API Tokens", href: "/settings/tokens" },
  { label: "Component Intelligence", href: "/settings/component-intelligence" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-md border border-border bg-card p-3 shadow-lg" aria-label="Settings navigation">
      <ul className="settings-nav-list flex flex-col gap-1" data-testid="settings-nav-list">
        {destinations.map((dest) => {
          const current = pathname === dest.href || pathname?.startsWith(`${dest.href}/`);
          return (
            <li key={dest.href}>
              <Link
                href={dest.href}
                // 44px on touch, back to the compact 36px once a pointer is precise -- the same
                // rule the product navigation rows follow.
                className={`settings-nav-link flex min-h-11 items-center rounded-sm px-3 py-2 text-sm md:min-h-9 ${current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                aria-current={current ? "page" : undefined}
              >
                {dest.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
