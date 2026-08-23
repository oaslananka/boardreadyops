import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState } from "../components/ui.js";

export default function NotFound() {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "BoardReadyOps" }, { label: "Page not found" }]} />
        <section className="run-state-surface">
          <EmptyState
            title="404 — Page not found"
            action={
              <Link className="button button-primary" href="/">
                Return to home
              </Link>
            }
          >
            <p>The requested page or route does not exist or has been relocated.</p>
          </EmptyState>
        </section>
      </main>
    </AppShell>
  );
}
