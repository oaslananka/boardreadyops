/** Written by tests/e2e/global-setup.ts. Specs needing a signed-in viewer do:
 *
 *   import { authenticatedStorageState } from "./fixtures/auth.js";
 *   test.use({ storageState: authenticatedStorageState });
 *
 * global-setup always writes this file. When no explicit secret is configured it uses the same
 * deterministic local-only secret as the Playwright webServer, so authenticated QA routes are
 * exercised as signed in instead of silently degrading to sign-in screens.
 */
export const authenticatedStorageState = "tests/e2e/.auth/storage-state.json";
