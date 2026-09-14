import { AppShell } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { viewerInstallations } from "../../../lib/viewer-installations.js";
import { DeadLettersClient } from "./dead-letters-client.js";

export const metadata = {
  title: "Dead-Letter Queue",
  description: "Stuck or dead-lettered release-run jobs and outbox records for your installations, with safe replay.",
};

export const dynamic = "force-dynamic";

export default async function DeadLettersPage() {
  const viewer = await viewerAuthorization();
  // Resolved server-side so the client never learns about an installation the session does not
  // cover, and the route re-checks the same scope on every request regardless.
  const installations = (await viewerInstallations(viewer.session, "nexar")).map((installation) => ({
    id: installation.id,
    accountLogin: installation.accountLogin,
  }));

  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[{ href: "/", label: "Home" }, { label: "Ops" }, { label: "Dead-Letter Queue" }]}
    >
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Dead-Letter Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lifecycle jobs and outbox records the control plane could not deliver, with their failure reason and — where
            the database has classified them as safe to repeat — a replay action. Scoped to the installations your
            account administers. An operator working across installations authenticates with the operator bearer token
            against the API directly; see <code>docs/operations/control-plane-reconciliation.md</code>.
          </p>
        </header>
        <DeadLettersClient installations={installations} />
      </main>
    </AppShell>
  );
}
