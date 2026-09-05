import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import PoliciesClient from "./policies-client.js";

export const metadata = {
  title: "Organization Policies",
  description: "Inheritance: Organization → Team → Repository → Review exception. No hidden precedence.",
};

export default function PoliciesPage() {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="policies-page-frame mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Policies" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Organization Governance & Release Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Release gates and verification rules bound to SHA-256 evidence digests. Inheritance: Organization → Team →
            Repository → Review exception.
          </p>
        </header>

        <PoliciesClient />
      </main>
    </AppShell>
  );
}
