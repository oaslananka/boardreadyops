export const metadata = {
  title: "API Tokens",
};

export default function TokensPage() {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-lg">
      <header>
        <h2 className="text-lg font-bold text-foreground">API Tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">Workspace-scoped bearer tokens for CLI and automation.</p>
      </header>
      <p className="mt-3 text-sm text-foreground">
        Tokens are shown only once at creation, stored as SHA-256 digests, and support scopes: runs:write,
        reviews:write, evidence:write. Expiry and revocation are supported.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Pass via BOARDREADYOPS_TOKEN or stdin/secure prompt — never as a CLI argument, and never logged.
      </p>
    </div>
  );
}
