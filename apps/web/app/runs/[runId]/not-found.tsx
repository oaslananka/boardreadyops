import Link from "next/link";
import { buttonVariants } from "../../../components/ui/button.js";
import { AppShell, Breadcrumbs, EmptyState } from "../../../components/ui.js";

export default function RunNotFound() {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Run unavailable" }]} />
        <h1 className="sr-only">Run unavailable</h1>
        <section className="run-state-surface">
          <EmptyState
            title="This run is not available"
            action={
              <Link className={buttonVariants({ variant: "default" })} href="/">
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
