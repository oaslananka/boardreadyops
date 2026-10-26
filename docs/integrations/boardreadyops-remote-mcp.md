# BoardReadyOps Remote MCP and AI Review UI

**Status (2026-10-26): implementation candidate, production DISABLED.** This is not yet a functioning ChatGPT / Claude.ai cloud connection. The existing **local stdio MCP** is shipped separately. See [common architecture](boardreadyops-agent-app.md).

> **Integrated release clarification (26 October 2026).** This file preserves the
> original PR #1249 experimental MCP Apps/Review UI design. It is **not** the
> implementation or OAuth policy for the public `/mcp` route on the unified
> branch. The only public handler is `apps/web/app/mcp/route.ts`, which requires
> both `BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED=true` and
> `BOARDREADYOPS_REMOTE_MCP_HANDLER_READY=true`, plus trusted first-party
> PKCE/RS256 OAuth grants and live GitHub App collaborator authorization.
> The old `BOARDREADYOPS_MCP_REMOTE_ENABLED` / external-JWKS route is **not
> wired**, even when set, and repository API tokens cannot authenticate the
> hosted MCP route. The only shared MCP Apps component already attached to
> the hardened endpoint is its authenticated HTML resource; richer listing,
> findings and footprint tools remain prototype-only. Production remains on
> release HOLD. See [foundation and live acceptance](boardreadyops-agent-app.md).
>
> The sections below describe the previous experimental, test-injected handler
> for reference only; do not treat them as public enablement instructions.

## Intended customer experience

1. Sign in to BoardReadyOps and connect a GitHub repository; Review data already exists in BoardReadyOps. The AI connector does **not** clone local Git repositories or upload KiCad design files.
2. When the OAuth authorization server and repository-grant issuance have passed security acceptance, add `https://boardreadyops.com/mcp` as a **custom remote MCP connector** in ChatGPT or Claude and follow the OAuth consent flow. The user selects which repository they authorize; no copying personal API tokens into the assistant.
3. Ask for recent hardware reviews, summarize rule categories and severity, or display source-verified footprint change counts. **Missing evidence displays as unavailable**, not as “nothing changed.”
4. The `ui://boardreadyops/review.html` MCP Apps widget shows only consented footprint counts and commit provenance; clients without MCP Apps support receive structured JSON/text.

This UX depends on an **external, approved OAuth 2.1 authorization server**, which is not provisioned or deployed by this code increment. Do not advertise “Connect now” until live end-to-end acceptance. No ChatGPT directory or Claude listing has been submitted.

## Wire contract

- **Resource URL:** `https://boardreadyops.com/mcp` (HTTPS, HTTP POST; GET returns 405).
- **Protocol:** MCP `2026-07-28` stateless exchange, using `Mcp-Method` / `Mcp-Name` and request `_meta`. SDK `@modelcontextprotocol/server` **2.3.1** is intentionally pinned: `2.4.0` (2026-10-23) is newer but violates this repository's mandatory 7-day minimum package release age. Existing stateless 2025 fallback is enabled for compatible older hosts; no stateful sessions are accepted.
- **Tools:** `boardreadyops_reviews_list`, `boardreadyops_review_get`, `boardreadyops_review_findings`, `boardreadyops_review_footprint_summary`. All read-only. No file uploads, releases, waivers, shell, arbitrary URLs, external network tools, or Git changes.
- **MCP Apps:** `ui://boardreadyops/review.html` resource, `text/html;profile=mcp-app`, bound to footprint summary tool. Sandboxed rendering with only `textContent`, no embedded access credentials or network requests.
- **Discovery:** `/.well-known/oauth-protected-resource` (RFC 9728) publishes resource URL and external issuer only when opt-in and valid OAuth configuration are enabled; the external issuer must provide AS metadata, PKCE S256, Resource Indicators, user consent and client registration compatible with the target hosts, ideally CIMD.

## Off-by-default settings

| Variable | Purpose |
| --- | --- |
| `BOARDREADYOPS_MCP_REMOTE_ENABLED=true` | Enables the protected `/mcp` route; **never enable in production solely to try it**. Disabled returns HTTP 404 before authentication, and discovery remains hidden. |
| `BOARDREADYOPS_MCP_OAUTH_ISSUER` | Trusted external HTTPS issuer URI, set only after issuer/operator validation. |
| `BOARDREADYOPS_MCP_OAUTH_JWKS_URI` | Trusted HTTPS JWKS on **the same origin** as issuer. |

The MCP server validates JWT signatures (`RS256` or `ES256`), exact issuer, exact `https://boardreadyops.com/mcp` audience, `iat`, `exp`, 15-minute maximum token age, and a UUID `repository_id` plus `reviews:read` scope before running tools. The issuer must independently enforce **current GitHub user/repository permission at grant issuance**, reject unauthorized repository identifiers, supply short-lived access tokens, and support revoke/disable operations. A cryptographically valid claim alone is **not** proof of current membership. Each read additionally checks active repository installation/subscription and review-to-repository identity; revoked installation or repository is denied. Full per-user membership revocation semantics need verified IdP acceptance before launch.

The existing repository-scoped `bro_live_...` API token may be used for **private integration testing only**; it is never a browser cookie or automatic ChatGPT account authorization. Do not publish those tokens in prompts, app submissions or screenshots. The existing GitHub login cookie **is not** an OAuth MCP access token.

## Privacy and security acceptance

- Cross-repository and cross-tenant request probes return no data. Unknown or invalid review UUIDs do not reveal repository existence.
- No raw PCB/schematic bytes, source file paths, BOM part lists, unbounded finding messages, user credentials or detailed footprint placements are returned. `review_findings` returns rule IDs, severity, kind and fingerprints only.
- Bounded request body (32 KiB) and bounded tool listings (20 reviews, 30 findings). No-store on protected responses and generic error messages. Production must implement/verify rate limits, structured logs without IP leakage and abuse monitoring at the reverse proxy.
- `boardreadyops_review_footprint_summary` reads only explicitly consented client-reported source evidence bound to the current review revision; returns `unavailable` otherwise. No AI fabrication verdict.
- UI is served through authenticated MCP resource read, never as a publicly hosted script. Validate rendered HTML CSP/network isolation with both real ChatGPT and Claude MCP Apps hosts.
- Test both resource-token and authorization-server metadata discovery, token expiry/revocation, repository grant reassignment, cross-tenant IDs, CDN/proxy caching, modern `Mcp-Method` and older 2025 stateless fallback, upgrade and rollback.
- Do not enable `BOARDREADYOPS_MCP_REMOTE_ENABLED` on production until external IdP metadata/grants, tenant revocation and host-specific app consent pass independent security review. Nothing in this branch provisions that IdP.

## Build and local verification

```sh
corepack pnpm install --frozen-lockfile
node scripts/build-mcp-review-view.mjs --check
corepack pnpm exec vitest run tests/unit/web/mcp-remote-route.test.ts tests/unit/web/mcp-token-authorization.test.ts
corepack pnpm --filter @boardreadyops/web typecheck
```

An unauthenticated `/mcp` GET returns 404 while disabled. No production deployment, `DATABASE_URL` modification or OAuth secrets are needed to run unit tests, which use injected authorization dependencies and non-production fixtures.
