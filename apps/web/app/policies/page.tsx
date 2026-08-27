import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import PoliciesClient from "./policies-client.js";

export const metadata = {
  title: "Organization Policies · BoardReadyOps",
  description: "Inheritance: Organization → Team → Repository → Review exception. No hidden precedence.",
};

export default function PoliciesPage() {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Policies" }]} />
        <header className="page-intro">
          <h1>Organization Policies</h1>
          <p>Inheritance: Organization → Team → Repository → Review exception. No hidden precedence.</p>
        </header>

        <div className="panel surface-raised">
          <p className="cell-note">
            Policy updates run a dry-run impact preview before enforcement. Expired waivers block production releases.
          </p>
          <PoliciesClient />
        </div>
      </main>
    </AppShell>
  );
}
