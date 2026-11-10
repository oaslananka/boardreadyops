import { Alert, AppShell } from "./ui.js";
import { ViewerNav } from "./viewer-nav.js";

export function RunUnavailable({ runId }: Readonly<{ runId: string }>) {
  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Run unavailable" }]}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <h1 className="sr-only">Run details temporarily unavailable</h1>
        <Alert title="Run details temporarily unavailable" tone="warning">
          <p>
            This deployment can't load run <code>{runId}</code> right now. No run data was inferred or cached by this
            page.
          </p>
          <p>
            If this persists, report it via a{" "}
            <a href="https://github.com/oaslananka/boardreadyops/issues/new" rel="noreferrer">
              GitHub issue
            </a>{" "}
            with this run ID; the operator responsible for this deployment can see the underlying cause in server logs.
          </p>
        </Alert>
      </main>
    </AppShell>
  );
}
