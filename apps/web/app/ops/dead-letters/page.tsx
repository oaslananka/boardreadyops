import { AppShell, Breadcrumbs } from "../../../components/ui.js";
import { DeadLettersClient } from "./dead-letters-client.js";

export const metadata = {
  title: "Dead-Letter Queue",
  description: "Operator view of stuck or dead-lettered release-run jobs and outbox records, with safe replay.",
};

export default function DeadLettersPage() {
  return (
    <AppShell>
      <main className="page-frame operational-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Ops" }, { label: "Dead-Letter Queue" }]} />
        <header className="page-intro">
          <h1>Dead-Letter Queue</h1>
          <p>
            Stuck lifecycle jobs and outbox records for a single installation, with their failure reason and, where the
            database has classified them as safe, a replay action. This is an internal operator surface authenticated
            with the operator bearer token — see <code>docs/operations/control-plane-reconciliation.md</code>.
          </p>
        </header>
        <DeadLettersClient />
      </main>
    </AppShell>
  );
}
