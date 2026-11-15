"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NativeSelect } from "../../components/ui/native-select.js";

const destinations = [
  { label: "Members", href: "/settings/workspace" },
  { label: "Billing & Plans", href: "/settings/billing" },
  { label: "Security & Access", href: "/settings/security" },
  { label: "Audit Log", href: "/settings/audit" },
  { label: "Data & Retention", href: "/settings/data" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "API Tokens", href: "/settings/tokens" },
  { label: "Component Intelligence", href: "/settings/component-intelligence" },
  { label: "Integrations & Health", href: "/settings/integrations" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref =
    destinations.find((dest) => pathname === dest.href || pathname?.startsWith(`${dest.href}/`))?.href ??
    destinations[0].href;

  return (
    <nav className="min-w-0 rounded-md border border-border bg-card p-3 shadow-e1" aria-label="Settings navigation">
      <label htmlFor="settings-destination" className="mb-2 block text-sm font-medium text-foreground lg:hidden">
        Settings section
      </label>
      <NativeSelect
        id="settings-destination"
        className="h-11 min-w-0 w-full lg:hidden"
        value={activeHref}
        onChange={(event) => {
          const nextHref = event.currentTarget.value;
          if (destinations.some((dest) => dest.href === nextHref)) router.push(nextHref);
        }}
      >
        {destinations.map((dest) => (
          <option key={dest.href} value={dest.href}>
            {dest.label}
          </option>
        ))}
      </NativeSelect>
      <ul className="settings-nav-list hidden flex-col gap-1 lg:flex" data-testid="settings-nav-list">
        {destinations.map((dest) => {
          const current = pathname === dest.href || pathname?.startsWith(`${dest.href}/`);
          return (
            <li key={dest.href}>
              <Link
                href={dest.href}
                className={`settings-nav-link flex min-h-9 items-center rounded-sm px-3 py-2 text-sm ${current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
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
