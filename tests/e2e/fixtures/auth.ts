/** Written by tests/e2e/global-setup.ts. Specs needing a signed-in viewer do:
 *
 *   import { authenticatedStorageState } from "./fixtures/auth.js";
 *   test.use({ storageState: authenticatedStorageState });
 *
 * If QA_SESSION_SECRET/SESSION_SECRET wasn't set, global-setup skips writing this file and the
 * spec runs signed out instead of failing outright -- authenticated-only assertions in that case
 * should expect a sign-in prompt rather than crash. See docs/qa-agent.md.
 */
export const authenticatedStorageState = "tests/e2e/.auth/storage-state.json";
