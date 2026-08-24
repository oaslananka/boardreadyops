import { viewerAuthorization } from "../lib/viewer-authorization.js";
import { ViewerControls } from "./viewer-controls.js";

/**
 * Sign-in state for a navigation bar.
 *
 * An async server component rather than a prop on the surrounding shell: reading the session
 * needs request-scoped cookies, and making every page that renders a header async would turn
 * each one into a promise its callers and tests would have to await.
 */
export async function ViewerNav() {
  const viewer = await viewerAuthorization();
  return <ViewerControls login={viewer.session?.login} />;
}
