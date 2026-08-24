/**
 * Sign-in state in the header.
 *
 * Signing in is a link because it starts a redirect the viewer initiated. Signing out is a form
 * POST so a third-party page cannot sign someone out by embedding a link to it.
 */
export function ViewerControls({ login }: Readonly<{ login: string | undefined }>) {
  if (!login) {
    return (
      <a className="viewer-signin" href="/api/auth/github/login">
        Sign in with GitHub
      </a>
    );
  }

  return (
    <span className="viewer-identity">
      <span className="viewer-login">{login}</span>
      <form action="/api/auth/logout" method="post">
        <button className="viewer-signout" type="submit">
          Sign out
        </button>
      </form>
    </span>
  );
}
