export default function TokensPage() {
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h2>API Tokens</h2>
          <p>Workspace-scoped bearer tokens for CLI and automation.</p>
        </div>
      </header>
      <p>
        Tokens are shown only once at creation, stored as SHA-256 digests, and support scopes: runs:write,
        reviews:write, evidence:write. Expiry and revocation are supported.
      </p>
      <p className="cell-note">
        Pass via BOARDREADYOPS_TOKEN or stdin/secure prompt — never as a CLI argument, and never logged.
      </p>
    </div>
  );
}
