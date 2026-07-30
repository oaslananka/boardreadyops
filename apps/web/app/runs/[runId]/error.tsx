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
        <Alert title="Run investigation could not be loaded" tone="danger">
          <p>The request failed without exposing database or tenant details. Retry the bounded dashboard query.</p>
          {error.digest ? (
            <p>
              Support reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <button className="button button-primary" type="button" onClick={reset}>
            Retry
          </button>
        </Alert>
      </main>
    </AppShell>
  );
}
