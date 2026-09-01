import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState } from "../components/ui.js";

export default function NotFound() {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Page not found" }]} />
        <section className="run-state-surface">
          <EmptyState
            title="This page does not exist"
            action={
              <Link className="button button-primary" href="/">
                Return to home
              </Link>
            }
          >
            <p>The link may be out of date — or the page may have moved.</p>
          </EmptyState>
        </section>
      </main>
    </AppShell>
  );
}
