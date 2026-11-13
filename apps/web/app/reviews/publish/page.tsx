import Link from "next/link";
import { ReviewBundlePublisher } from "../../../components/review/review-bundle-publisher.js";
import { AppShell } from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const metadata = {
  title: "Publish local Review evidence",
  description: "Choose and publish locally generated KiCad Review evidence with an authorized GitHub session.",
};
export const dynamic = "force-dynamic";

export default async function PublishReviewPage() {
  const viewer = await viewerAuthorization();
  return (
    <AppShell
      viewerNav={<ViewerNav />}
      breadcrumbs={[{ href: "/", label: "Home" }, { href: "/reviews", label: "Reviews" }, { label: "Publish" }]}
    >
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-7 sm:px-6 sm:py-9" id="main-content">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Review · Create</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Publish local hardware evidence
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Review the exact Git source, recorded blockers and optional native PCB drawings before any evidence leaves
            your device.
          </p>
        </header>
        {viewer.session ? (
          <ReviewBundlePublisher />
        ) : (
          <section className="max-w-xl rounded-xl border border-border bg-card p-6">
            <h2 className="font-display text-xl font-semibold">Connect your GitHub account</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to authorize publication only to repositories available through your GitHub installation.
            </p>
            <Link
              href="/api/auth/github/login"
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              Sign in with GitHub
            </Link>
          </section>
        )}
      </main>
    </AppShell>
  );
}
