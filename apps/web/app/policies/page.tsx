import { AppShell } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { optionalCloudPersistenceConfiguration } from "../../lib/cloud-runtime-config.js";
import PoliciesClient from "./policies-client.js";

export const metadata = {
  title: "Organization Policies",
  description:
    "Hosted review policies use organization baselines with repository overrides. Team and review exceptions are not enforced.",
};

export const dynamic = "force-dynamic";

export default function PoliciesPage() {
  // The server already knows whether there is anything to fetch. Telling the client spares it a
  // request that can only answer 503, and lets the page say what is actually wrong.
  const storageConfigured = optionalCloudPersistenceConfiguration()?.mode === "postgres";

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Policies" }]}>
      <main className="policies-page-frame mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Organization Governance & Release Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hosted reviews enforce organization and repository policies. Team and review exceptions are not enforced;
            repository overrides can relax rules.
          </p>
        </header>

        <PoliciesClient storageConfigured={storageConfigured} />
      </main>
    </AppShell>
  );
}
