"use client";

import { Button } from "../components/ui/button.js";
import { Alert, AppShell } from "../components/ui.js";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppShell breadcrumbs={[{ href: "/", label: "Home" }, { label: "Application error" }]}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
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
            <Button type="button" onClick={reset} className="mt-2">
              Retry
            </Button>
          </Alert>
        </section>
      </main>
    </AppShell>
  );
}
