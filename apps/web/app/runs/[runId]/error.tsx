"use client";

import { Button } from "../../../components/ui/button.js";
import { Alert, AppShell, Breadcrumbs } from "../../../components/ui.js";

export default function RunError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Run error" }]} />
        <section className="run-state-surface">
          <Alert title="Could not load this run" tone="danger">
            <p>Something went wrong on our side. Try again — the run itself is unaffected.</p>
            {error.digest ? (
              <p>
                Support reference: <code>{error.digest}</code>
              </p>
            ) : null}
            <Button type="button" onClick={reset} className="mt-2">
              Retry
            </Button>
          </Alert>
        </section>
      </main>
    </AppShell>
  );
}
