/**
 * Sign-in state in the header.
 *
 * Signing in is a link because it starts a redirect the viewer initiated. Signing out is a form
 * POST so a third-party page cannot sign someone out by embedding a link to it.
 */
export function ViewerControls({ login }: Readonly<{ login: string | undefined }>) {
  if (!login) {
    return (
      <a
        className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
        href="/api/auth/github/login"
      >
        Sign in with GitHub
      </a>
    );
  }

  return (
    <span className="flex items-center gap-3 text-sm">
      <span className="text-foreground">{login}</span>
      <form action="/api/auth/logout" method="post">
        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          type="submit"
        >
          Sign out
        </button>
      </form>
    </span>
  );
}
