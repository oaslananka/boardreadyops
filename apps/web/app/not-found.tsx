import Link from "next/link";
import { buttonVariants } from "../components/ui/button.js";
import { AppShell, Breadcrumbs, EmptyState } from "../components/ui.js";

export default function NotFound() {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Page not found" }]} />
        <h1 className="sr-only">Page not found</h1>
        <section className="run-state-surface">
          <EmptyState
            title="This page does not exist"
            action={
              <Link className={buttonVariants({ variant: "default" })} href="/">
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
