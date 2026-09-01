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
    <nav className="settings-navigation panel surface-raised" aria-label="Settings navigation">
      <ul className="settings-nav-list">
        {destinations.map((dest) => {
          const current = pathname === dest.href || pathname?.startsWith(`${dest.href}/`);
          return (
            <li key={dest.href}>
              <Link href={dest.href} className="settings-nav-link" aria-current={current ? "page" : undefined}>
                {dest.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
