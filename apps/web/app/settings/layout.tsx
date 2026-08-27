import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

const destinations = [
  { label: "Billing & Seats", href: "/settings/billing" },
  { label: "Security & Access", href: "/settings/security" },
  { label: "Data & Retention", href: "/settings/data" },
  { label: "API Tokens", href: "/settings/tokens" },
  { label: "Component Intelligence", href: "/settings/component-intelligence" },
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page settings-frame" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Settings" }]} />
        <header className="page-intro">
          <h1>Workspace Settings</h1>
          <p>Manage subscription seats, access security, retention policies, tokens, and data sources.</p>
        </header>

        <div className="settings-layout-grid">
          <nav className="settings-navigation panel surface-raised" aria-label="Settings navigation">
            <ul className="settings-nav-list">
              {destinations.map((dest) => (
                <li key={dest.href}>
                  <Link href={dest.href} className="settings-nav-link">
                    {dest.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section className="settings-content">{children}</section>
        </div>
      </main>
    </AppShell>
  );
}
