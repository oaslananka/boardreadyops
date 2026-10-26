# BoardReadyOps AI App — Common MCP Gateway Design

**Status:** staged implementation; remote endpoint fails closed (HTTP 503) pending OAuth acceptance. **Not a deployed remote connector, not an app-directory listing.**

## Product decision

Ship **one BoardReadyOps decision/evidence engine** and one agent-facing MCP contract,
not separate AI products. ChatGPT and Claude are client/distribution channels.
The existing local stdio MCP implementation in `packages/mcp-server` already exposes
`check`, `plan`, and `verify_bundle`, plus a local, counts-only footprint summary tool.
It is not a cloud-hosted MCP endpoint.

## User value and priorities

1. **Now:** Local coding agents (Claude Code, Cursor, other MCP clients) ask for
   deterministic findings, remediation plans, signed bundle verification, and verified
   Git PCB footprint change counts. Keep all KiCad source data in the user's workspace.
2. **Next:** Read-only **remote MCP** for already-authorized hosted Review summaries,
   findings and source-bound, consented digest/count evidence. No Git clone or KiCad
   subprocess on the hosted MCP worker. The hosted Review API/contract remains the
   authority and shall revalidate tenant/repository/review ownership on **every** call.
3. **After remote acceptance:** One portable **MCP Apps** evidence Review UI, tested in
   both ChatGPT and Claude. Show evidence-backed change counts, unavailable coverage,
   policy/DRC findings with links to reviewed objects. Avoid a parallel Claude website;
   continue using BoardReadyOps' existing web app for full workflows.

## Trust and execution boundaries

- **Local stdio MCP:** Invokes only the installed BoardReadyOps CLI with fixed command
  shapes and validated inputs. Read-only by default. No `generate`, `release prepare`,
  auto-fix, waiver or publish tools without a separately reviewed capability-elevation
  design. An AI summary never substitutes for the deterministic pipeline verdict.
- **Hosted remote MCP — not yet implemented:** Dedicated HTTPS MCP resource server,
  standards-compliant OAuth 2.1 / MCP protected resource discovery, PKCE, short-lived
  audience-restricted tokens, token revocation, tenant-scoped `review:read` and
  `evidence:read` permissions. The scopes are **proposed** and do not exist yet.
  Recheck the authenticated user's workspace membership, installation and repository
  authority for **each** review/read; reject cross-tenant ids, stale links and revoked
  scopes. Avoid service credentials shared across customer tenants.
- **Data minimization:** Default remote tools to source hashes, fixed fingerprints,
  bounded counts, deterministic finding text and existing tenant-authorized review
  links. Do not proxy raw `.kicad_pcb`, `.kicad_sch`, BOMs, private repository contents,
  absolute source paths, user tokens or arbitrary local files. Never convert partial
  coverage or `unavailable` to a pass or a removal/addition claim.
- **No open arbitrary process proxy:** Remote tools cannot accept shell commands,
  filesystem paths, URLs to fetch, arbitrary tenant ids, rule bypass flags, prompt
  supplied SQL or mutation actions. Explicit resource ids must resolve to objects in
  the caller's authorized workspace. Enforce rate limits, response-size bounds, audit
  logs without CAD IP, and defensive error normalization.
- **Interactive MCP Apps:** One sandboxed `ui://` review resource showing data returned
  by an authorized `review_get` tool. No long-lived tokens in UI HTML/JS, no direct
  database access, no arbitrary external content or untrusted Markdown executed as
  instructions. All user-triggered tool calls go back through the authenticated MCP
  host. Fall back to structured text when the host lacks MCP Apps support.

## Proposed hosted tool contract (not registered yet)

| Tool | Inputs | Authorized response | State |
| --- | --- | --- | --- |
| `boardreadyops_review_get` | `reviewId` | State, explicitly qualified coverage, authorized repository and PR link | Planned |
| `boardreadyops_review_findings` | `reviewId`, `cursor?` | Bounded deterministic findings, evidence fingerprint, page cursor | Planned |
| `boardreadyops_review_footprint_summary` | `reviewId` | Consented source-bound digest/count facts, or `unavailable` | Planned |
| `boardreadyops_evidence_get` | `evidenceId` | Metadata/hash and authorized in-app link, not raw design bytes | Planned |

Tool schemas must be drawn from the existing versioned contracts before implementation.
Do not reuse local stdio filesystem inputs as remote MCP tool inputs.

## Acceptance gates

- Cross-tenant ID probing, wrong-resource OAuth audience, expired/revoked scopes,
  missing membership and repository installation revocation **all** deny by default.
- Host never invokes CLI on a user-provided path, never returns raw CAD source, never
  discloses source on error or in logs. Results have bounded size and stable versioning.
- The UI renders real authorized Review data and an explicit `unavailable` state; no
  demo/fixture evidence can be presented as real source. Works with both ChatGPT and
  Claude using the **same server and UI resource**, with a text fallback.
- Test across tenant, repository, source version and published/revoked review states.
  Review threat model and privacy settings; complete manual client OAuth handshake
  and test against a representative real Git PR before submitting to app directories.
- Observe adoption, review-completion rate, and correction of blocked findings before
  investing in new monetization or mutating tools.

## Explicitly deferred

Production remote endpoint, OAuth client registration, ChatGPT directory submission,
Claude connector listing, write-capable agent tools and additional billing are **not**
part of this increment. They must not be claimed or activated before the gates above.

## Upstream references

- [MCP authorization (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Apps](https://apps.extensions.modelcontextprotocol.io/)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/)
- [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

## 2026-10-26 implementation checkpoint

`/mcp` is reserved on the existing Next.js host but deliberately returns HTTP 503 for
GET, POST and DELETE. Neither web sessions nor existing repository-scoped bearer
API tokens grant remote MCP access. The tested resource metadata builder uses the
canonical `https://boardreadyops.com/mcp` audience; its OAuth discovery route is
**not published**, as no user-bound authorization server or live revocation validation
exists yet. The existing count/digest-only PCB contract is reused for prospective
read-only tool results, with unavailable/client-reported states kept distinct.

The 2026-07-28 core specification added stateless HTTP, header-based request
routing and cacheable lists. MCP Apps is a separately versioned extension. Do not
claim ChatGPT/Claude compatibility until each host's OAuth and UI flow has passed
real end-to-end tests. Before enabling this route, implement short-lived
audience-restricted OAuth grants, enforce current workspace/repository membership
for **every** read, then use the official MCP v2 `@modelcontextprotocol/server`
transport and test both clients. Keep the existing v1 `@modelcontextprotocol/sdk`
local stdio implementation on its supported maintenance line unless a separate
compatibility migration is justified.
This checkpoint neither configures secrets nor changes production or database schema.

## Local authorization boundary (26 October 2026, later increment)

`apps/web/lib/remote-mcp-access.ts` now contains a testable **disabled-by-default**
remote-read policy. Only a signature-verified, audience-bound, user-bound, expiring
OAuth grant with a current non-revoked `jti` can reach the Review repository lookup.
The token validator and grant revocation store are required integration adapters,
not yet implemented or wired to `/mcp`. A separate live GitHub user-to-repository
permission check is mandatory for every read. Historical login-time
`installationIds`, GitHub App installation ownership, repository name aliases and
unverified workspace/project names **do not** satisfy that check. Suspended,
disabled and cancelled installations are rejected in the read query. A missing,
revoked or unreachable permission check denies access; private Review identifiers
must not be discoverable through error differences. Current revision evidence is
loaded only after that authorization check and returned through an allowlist.

The helper also verifies OAuth authorization-code PKCE `S256` using RFC 7636's
test vector; `plain` is intentionally rejected. It is *not* an authorization server,
and no code grants or OAuth token exchanges are active. The still-missing steps
before a real client can connect are: verified GitHub user grants and live repo
permission adapter, durable revocation storage, cryptographic token verification,
OAuth authorization + PKCE issuance, discovery and the official MCP v2 HTTP handler.
Do not enable remote tools by substituting CLI repository API tokens or browser
session cookies for this integration. No production route or user permissions changed.

### Current GitHub collaborator authorization adapter

`apps/web/lib/remote-mcp-github-permission.ts` reuses the existing GitHub App
credentials. After receiving a **signature-verified** user's stable GitHub ID
from the future OAuth resource layer, it mints an installation token, resolves
`GET /user/{account_id}` to the user's current login, verifies the GitHub
repository's numeric ID against the Review-owning record, and asks GitHub for
`GET /repos/{owner}/{repo}/collaborators/{username}/permission`. A live
`read`/`write`/`admin` (or mapped `triage`/`maintain`) response is mandatory.
The service never accepts an installation token as proof of a *user's* access.
Disabled repository/installation checks are enforced separately in SQL.

This adapter is injectable/tested locally, but **not connected to production
OAuth or `/mcp`**. It fails closed on GitHub errors, rate limits, changed IDs,
revoked collaborators, missing credentials and untrusted redirects. No token
is included in the tool response or persisted by the adapter. For every MCP
request, token/grant activity and repository permission must be checked anew.

Primary API references: https://docs.github.com/en/rest/users/users and
https://docs.github.com/en/rest/collaborators/collaborators.

## 2026-10-26 remote MCP resource-server increment (local only)

- The remote HTTP implementation now uses official stable
  `@modelcontextprotocol/server@2.3.1` (the newer 2.4.0 cannot pass the
  repository's minimum-release-age policy). It serves the modern 2026-07-28
  era and stateless legacy clients from one tool registry. The existing stdio
  MCP package is unchanged.
- A **test-only injected route** exposes `boardreadyops_review_get` with bounded
  schema-validated input, an allowlisted facts-only response, a generic
  unavailable result and fresh per-call repository permission checks.
  Unauthorized HTTP requests receive a `401` OAuth metadata challenge. The
  production `/mcp` route is still deliberately `503`.
- `jose` checks trusted issuer, MCP-specific audience, asymmetric RS256/ES256
  signatures, expiry, user identity and client binding. The durable
  `remote_mcp_oauth_grants` table additionally binds active JTI, user, client,
  issuer, audience and one-hour expiry, and supports immediate revocation.
  No raw access token is stored in the grant table. Migration 0095 was exercised
  on a disposable, network-isolated PostgreSQL 17 instance; **it has not been
  applied to staging or production**.
- The caller cannot substitute a browser cookie or existing repository API
  token. Host and Origin are conservatively restricted in the injected HTTP
  adapter until cross-client acceptance establishes a safe deployment policy.
- **Still missing:** consent screen, OAuth authorization-code issuance/exchange,
  PKCE-bound single-use codes, verified client metadata/redirect allowlisting,
  signing-key/JWKS lifecycle, discoverable live OAuth endpoints, audit/rate
  limits and real ChatGPT/Claude OAuth/UI tests. No production enablement,
  directory listing or auto-approval is authorized by this increment.

Reference: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
