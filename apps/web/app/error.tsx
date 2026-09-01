"use client";

import { Alert, AppShell, Breadcrumbs } from "../components/ui.js";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Application error" }]} />
        <section className="run-state-surface">
          <Alert title="Something went wrong" tone="danger">
            <p>
              This page did not load. Trying again usually works; if it keeps happening, the run is still safe in
              GitHub.
            </p>
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
