"use client";

import { Alert, AppShell, Breadcrumbs } from "../../../components/ui.js";

export default function RunError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "BoardReadyOps" }, { label: "Run error" }]} />
        <section className="run-state-surface">
          <Alert title="Could not load this run" tone="danger">
            <p>Something went wrong on our side. Try again — the run itself is unaffected.</p>
            {error.digest ? (
              <p>
                Support reference: <code>{error.digest}</code>
              </p>
            ) : null}
            <button className="button button-primary" type="button" onClick={reset}>
              Retry
            </button>
          </Alert>
        </section>
      </main>
    </AppShell>
  );
}
