import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FullConfig } from "@playwright/test";
import { encodeUserSession, type UserSession } from "../../apps/web/lib/user-session.js";
import { authenticatedStorageState } from "./fixtures/auth.js";

const defaultQaSessionSecret = "qa-agent-local-session-secret-not-for-production!";

/**
 * Mints the deterministic local QA session directly into Playwright storage state. Keeping this
 * browser-independent lets Firefox/WebKit matrix jobs run without installing Chromium just for
 * global setup. The default secret matches playwright.config.ts's local webServer fallback.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const secret = process.env.QA_SESSION_SECRET ?? process.env.SESSION_SECRET ?? defaultQaSessionSecret;
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const url = new URL(baseURL);
  const now = new Date();
  const session: UserSession = {
    userId: 1,
    login: "qa-agent",
    installationIds: [],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
  };
  const token = encodeUserSession(session, secret);

  await mkdir(dirname(authenticatedStorageState), { recursive: true });
  await writeFile(
    authenticatedStorageState,
    JSON.stringify({
      cookies: [
        {
          name: "brops_session",
          value: token,
          domain: url.hostname,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: url.protocol === "https:",
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}

export default globalSetup;
