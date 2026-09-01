import { defineConfig, devices } from "@playwright/test";

const qaSessionSecret =
  process.env.QA_SESSION_SECRET ?? process.env.SESSION_SECRET ?? "qa-agent-local-session-secret-not-for-production!";

// Nightly/full runs opt into Firefox and WebKit with QA_CROSS_BROWSER=1; PRs stay Chromium-only
// for speed. See docs/qa-agent.md and .github/workflows/qa-nightly.yml.
const crossBrowser = process.env.QA_CROSS_BROWSER === "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "qa-report.json" }]]
    : [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "corepack pnpm --filter @boardreadyops/web dev --port 3000",
    url: "http://127.0.0.1:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      SESSION_SECRET: qaSessionSecret,
      QA_SESSION_SECRET: qaSessionSecret,
      NODE_ENV: process.env.NODE_ENV ?? "test",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    ...(crossBrowser
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
        ]
      : []),
  ],
});
