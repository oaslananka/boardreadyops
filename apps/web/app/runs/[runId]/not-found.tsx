import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState } from "../../../components/ui.js";

export default function RunNotFound() {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Run unavailable" }]} />
        <section className="run-state-surface">
          <EmptyState
            title="This run is not available"
            action={
              <Link className="button button-primary" href="/">
                Return home
              </Link>
            }
          >
            <p>The link may be wrong, the run may have aged out, or it may belong to a repository you cannot see.</p>
          </EmptyState>
        </section>
      </main>
    </AppShell>
  );
}
