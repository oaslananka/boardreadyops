import { chromium, type FullConfig } from "@playwright/test";
import { encodeUserSession, type UserSession } from "../../apps/web/lib/user-session.js";

/**
 * Mints a valid signed `brops_session` cookie and saves it as Playwright storage state, so
 * authenticated E2E specs start signed in without a live GitHub OAuth round trip.
 *
 * Requires QA_SESSION_SECRET (or SESSION_SECRET) >= 32 chars in the environment the Next.js
 * dev/prod server under test was started with — the signature has to verify against the same
 * secret the server reads via `configuredSessionSecret()`. The "authenticated" Playwright
 * project consumes the resulting storageState file; the default project stays signed out.
 *
 * This session carries no installationIds, so it satisfies routes that only need "is someone
 * signed in" (Policies, My Work, Settings). Routes that also require the viewer to own a real
 * GitHub App installation with data in Postgres (Dashboard, /repositories/:id) still need
 * DATABASE_URL and a seeded installation — see qa/audit/routes.ts's `requiresDb` flag and
 * docs/qa-agent.md.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const secret = process.env.QA_SESSION_SECRET ?? process.env.SESSION_SECRET;
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const url = new URL(baseURL);

  const browser = await chromium.launch();
  const context = await browser.newContext();

  if (!secret || secret.length < 32) {
    // biome-ignore lint/suspicious/noConsole: operational warning, not debug noise -- the point is for a human running qa:* to see it.
    console.warn(
      "[qa] QA_SESSION_SECRET/SESSION_SECRET is unset or shorter than 32 chars -- skipping the signed-in cookie. " +
        "Specs using authenticatedStorageState will run signed out instead of failing on a missing file.",
    );
  } else {
    const now = new Date();
    const session: UserSession = {
      userId: 1,
      login: "qa-agent",
      installationIds: [],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    };
    const token = encodeUserSession(session, secret);
    await context.addCookies([
      {
        name: "brops_session",
        value: token,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
  }

  // Always written, even signed out: a spec doing test.use({ storageState: authenticatedStorageState })
  // would otherwise hard-fail with ENOENT rather than degrading to running signed out.
  await context.storageState({ path: "tests/e2e/.auth/storage-state.json" });
  await browser.close();
}

export default globalSetup;
