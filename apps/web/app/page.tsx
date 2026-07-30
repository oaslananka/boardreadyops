import Link from "next/link";
import { AppShell } from "../components/ui.js";

export default function HomePage() {
  return (
    <AppShell>
      <main className="shell" id="main-content">
        <section className="home-hero">
          <h1>Release evidence that leads to a decision.</h1>
          <p>
            BoardReadyOps turns normalized hardware checks into a traceable investigation: decision, execution attempts,
            findings, artifacts, publication state, and privacy-bounded audit evidence.
          </p>
          <div>
            <Link
              className="button button-primary"
              href="https://docs.boardreadyops.com/product/zero-config-onboarding/"
            >
              Connect a repository
            </Link>
          </div>
        </section>
        <section className="home-grid" aria-label="Investigation capabilities">
          <article>
            <h2>Decision first</h2>
            <p>See the stable readiness result and the shortest next action before opening low-level evidence.</p>
          </article>
          <article>
            <h2>Bounded investigation</h2>
            <p>
              Search and page through findings and artifacts without loading unbounded tenant data into the browser.
            </p>
          </article>
          <article>
            <h2>Authoritative sources</h2>
            <p>Verify checksums, GitHub publication state, and repository-owned workflow evidence before release.</p>
          </article>
        </section>
      </main>
    </AppShell>
  );
}
