import { defineConfig } from "@playwright/test";

/**
 * Separate config for `pnpm qa:production-smoke`: no webServer (it targets a real deployed
 * instance, not a local dev server), and PLAYWRIGHT_BASE_URL must be set explicitly -- no
 * default that could point at production by accident. tests/e2e/production-smoke.spec.ts is
 * the only thing this config runs, and every assertion in that file must stay read-only; see
 * the hard guard in qa/audit/production-guard.ts and docs/qa-agent.md.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /production-smoke\.spec\.ts$/,
  timeout: 20_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
