import type { ReactNode } from "react";
import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { SettingsNav } from "./settings-nav.js";

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
          <SettingsNav />

          <section className="settings-content">{children}</section>
        </div>
      </main>
    </AppShell>
  );
}
