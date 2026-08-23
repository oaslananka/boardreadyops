"use client";

import { Alert, AppShell, Breadcrumbs } from "../components/ui.js";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "BoardReadyOps" }, { label: "Application error" }]} />
        <section className="run-state-surface">
          <Alert title="Application error" tone="danger">
            <p>An unexpected error occurred while loading this page.</p>
            {error.digest ? (
              <p>
                Diagnostic reference: <code>{error.digest}</code>
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
