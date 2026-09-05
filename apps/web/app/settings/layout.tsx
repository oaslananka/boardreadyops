import type { ReactNode } from "react";
import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { SettingsNav } from "./settings-nav.js";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Settings" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Workspace Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage subscription seats, access security, retention policies, tokens, and data sources.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
          <SettingsNav />

          <section>{children}</section>
        </div>
      </main>
    </AppShell>
  );
}
