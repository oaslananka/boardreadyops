# Authenticated UI audit

BoardReadyOps keeps the existing public Lighthouse CI for anonymous routes and adds a separate authenticated Lighthouse audit for signed-in product surfaces. The authenticated audit is manual-only because it requires a current short-lived `brops_session` cookie.

## Security boundary

`BROPS_SESSION` and the GitHub Actions secret `BROPS_UNLIGHTHOUSE_SESSION` are ephemeral credentials. Never commit them, write them to `.env`, paste them into issues or pull requests, or attach them to audit artifacts.

The runner accepts production auth only for `https://boardreadyops.com`. Loopback HTTP is allowed only for local test fixtures. Route discovery is same-origin and allowlist-only, and the generated `.unlighthouse/authenticated-routes.json` contains no cookie or response body.

The audit passes the cookie to Lighthouse only through the in-memory `extraHeaders` request setting. Raw Lighthouse HTML/JSON is deliberately never persisted because those formats can serialize configuration metadata. The artifact contains only BoardReadyOps-owned, secret-free route and score summaries.

## Obtain a local session

1. Sign in to `https://boardreadyops.com` normally with GitHub.
2. Open Chrome DevTools.
3. Open **Application → Cookies → https://boardreadyops.com**.
4. Copy the current `brops_session` value.
5. Keep the value only in the current shell environment.

The cookie expires according to the application's normal browser-session lifetime. If discovery reports an authentication failure, obtain a fresh session instead of bypassing the check.

## Run locally

PowerShell:

```powershell
$env:BROPS_SESSION = "<current brops_session>"
corepack pnpm run qa:unlighthouse:auth
Remove-Item Env:BROPS_SESSION
```

Bash:

```bash
export BROPS_SESSION='<current brops_session>'
corepack pnpm run qa:unlighthouse:auth
unset BROPS_SESSION
```

Use `corepack pnpm run qa:unlighthouse:auth:routes` to verify authentication and discovered routes without running Lighthouse. Use `corepack pnpm run qa:unlighthouse:auth:debug` only for local browser troubleshooting.

Reports are written under `.unlighthouse/authenticated/`; the secret-free route manifest is `.unlighthouse/authenticated-routes.json`. The whole `.unlighthouse/` tree is ignored by Git.

## Manual GitHub Actions audit

The **Authenticated UI audit** workflow is `workflow_dispatch` only. It has `contents: read` permission and never runs on pull-request, push, or scheduled code.

Before dispatching it, refresh the repository secret `BROPS_UNLIGHTHOUSE_SESSION` with a current production `brops_session`. The secret is scoped only to the explicit session-validation step and the audit step; checkout, toolchain setup, and artifact upload do not receive it.

After the run, download the private `authenticated-unlighthouse-<run-id>` artifact. The historical artifact name is retained for workflow compatibility; its contents are the secret-free route manifest plus the bounded Lighthouse score summary, retained for seven days.

Initial authenticated budgets are:

- performance: 70
- accessibility: 90
- best-practices: 85

A route that never reaches a terminal Lighthouse result fails the command even if other scores pass. Authentication redirects, 401, and 403 responses fail closed rather than falling back to anonymous pages.

## Implementation note

The audit runner uses the pinned `lighthouse` and `chrome-launcher` packages directly. Route discovery stays BoardReadyOps-owned, and the ephemeral session cookie is supplied only through Lighthouse's in-memory request headers. Raw Lighthouse HTML/JSON is not persisted because it can include configuration metadata; the uploaded artifact contains the secret-free route manifest and a bounded score summary instead.

Chrome is launched from the preinstalled runner browser with downloads disabled by construction. Each discovered route is audited sequentially, and Chrome is closed in a `finally` block even when one route fails.
