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
      <main className="page-frame operational-page policies-page-frame" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Policies" }]} />
        <header className="page-intro">
          <h1>Organization Governance & Release Policies</h1>
          <p>
            Release gates and verification rules bound to SHA-256 evidence digests. Inheritance: Organization → Team →
            Repository → Review exception.
          </p>
        </header>

        <PoliciesClient />
      </main>
    </AppShell>
  );
}
