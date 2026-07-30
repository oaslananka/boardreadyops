import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState } from "../../../components/ui.js";

export default function RunNotFound() {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "BoardReadyOps" }, { label: "Run unavailable" }]} />
        <EmptyState
          title="Run not found or no longer available"
          action={
            <Link className="button button-primary" href="/">
              Return home
            </Link>
          }
        >
          <p>
            The identifier is invalid, unauthorized for this deployment, expired, or removed by a lifecycle operation.
          </p>
        </EmptyState>
      </main>
    </AppShell>
  );
}
