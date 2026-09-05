import Link from "next/link";
import { viewerAuthorization } from "../lib/viewer-authorization.js";
import { buttonVariants } from "./ui/button.js";
import { ViewerControls } from "./viewer-controls.js";

/**
 * Landing-page actions that differ for a prospect and a customer.
 *
 * The landing page used to offer everyone the same thing: Install on GitHub. Somebody who had
 * already installed it, and was signed in, had no route to their own dashboard from the page
 * they land on — the marketing navigation carried no link to it and the primary button asked
 * them to install a second time.
 *
 * So the actions are split by who is reading. A prospect is asked to install; a customer is
 * taken to their repositories. One primary action each, never both.
 */

export const installUrl = "https://github.com/apps/boardreadyops/installations/new";

const navCtaClass = buttonVariants({ variant: "default", size: "sm" });
const primaryClass = `${buttonVariants({ variant: "default", size: "lg" })} gap-2`;
const secondaryClass = buttonVariants({ variant: "secondary", size: "lg" });

export async function LandingNavActions() {
  const session = (await viewerAuthorization()).session;

  if (!session) {
    return (
      <>
        <ViewerControls login={undefined} />
        <a className={navCtaClass} href={installUrl}>
          Install on GitHub
        </a>
      </>
    );
  }

  return (
    <>
      <ViewerControls login={session.login} />
      {/* The dashboard is the primary action for somebody who has already installed, so it is
          the button rather than another link competing with the marketing anchors. */}
      <Link className={navCtaClass} href="/dashboard">
        Open dashboard
      </Link>
    </>
  );
}

export async function LandingHeroActions() {
  const session = (await viewerAuthorization()).session;

  if (!session) {
    return (
      <>
        <a className={primaryClass} href={installUrl}>
          <span>Install on GitHub</span>
          <span aria-hidden="true">↗</span>
        </a>
        <Link className={secondaryClass} href="/setup">
          Preview repository setup
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className={primaryClass} href="/dashboard">
        <span>Open dashboard</span>
        <span aria-hidden="true">→</span>
      </Link>
      <a className={secondaryClass} href={installUrl}>
        Add another repository
      </a>
    </>
  );
}
