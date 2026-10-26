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

This GitHub permission adapter is injectable/tested locally and now composed
behind the disabled-by-default OAuth/MCP route gates; no production deployment
or live user-specific GitHub App collaborator acceptance was performed. It fails closed on GitHub errors, rate limits, changed IDs,
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
  locally guarded `/mcp` route denies by default with `503`; the older
  hosted deployment currently returns `404` and was not changed.
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

### Authorization-code / consent groundwork (26 October 2026)

Migration **0096** introduces a disabled-by-default **pre-registered client registry**
(exact HTTPS client ID and exact redirect URI, `enabled=false`) plus a
per-user authorization consent/code store. Neither SQL migration has been
applied to the production database, and **no client registrations have been
created**. Client ID Metadata Documents and dynamic client registration are
not yet accepted: public metadata URLs must undergo SSRF hardening and an
explicit trust policy before enabling that path.

Internal `beginRemoteMcpConsent` validates `response_type=code`, S256 challenge,
registered and enabled client, exact callback URL, allowed read scopes and the
canonical MCP resource. It takes a stable GitHub user ID **only from a caller
that has verified a signed browser session**; the OAuth client must never supply
that user ID. The application must display the client identity, callback host
and requested scopes and require an explicit POST approval with the
unpredictable CSRF nonce before using `decideRemoteMcpConsent`.

One-time consent decisions are bound to the user and expire after **10 minutes**;
authorization codes expire after **90 seconds**, with only their SHA-256 digests
persisted. `exchangeRemoteMcpAuthorizationCode` validates the exact client,
redirect URI and S256 verifier, then atomically consumes the code and inserts a
15-minute audience-bound grant in one database transaction. Concurrent exchanges
produce at most one successful token. Authorization denial returns `access_denied`
and cannot later be upgraded without a new user interaction.

The internal form-encoded token HTTP adapter refuses browser cookies, query
credentials, duplicate fields, client secrets, unsupported grant types and
wrong `resource`. It does **not** expose the token endpoint publicly. The
RSA-2048+ RS256 signer emits access JWTs with `kid`, stable GitHub subject,
OAuth client ID, token lifetime and MCP-specific audience. Its public JWKS
contains only public key material. Private keys and key IDs must be sourced
from Doppler at deployment, never added to GitHub secrets or source control.
A safe rollover plan must retain prior public keys until all associated tokens
expire; JWKS and RFC 8414 metadata are only in-process builders for now.

All nine authorization-flow checks (including same-code parallel exchanges,
disabled clients and signed JWT revocation) passed against a disposable local
PostgreSQL 17 instance. This is a **local security increment**, not evidence of
complete OAuth client integration or ChatGPT/Claude interoperability. Before
turning on the existing `/mcp` endpoint: implement session-bound consent pages,
same-origin POST/CSRF protection, production issuer and metadata routing,
pre-registered ChatGPT/Claude client details, trusted signing key rotation,
request throttling, activity audit and representative live user testing.

### OAuth browser consent and discovery routes (next local increment)

The **disabled-by-default** Next.js routes are implemented at
`/oauth/authorize` (GET/POST), `/oauth/token` (POST),
`/.well-known/oauth-authorization-server`, `/.well-known/jwks.json` and
`/.well-known/oauth-protected-resource/mcp`. The existing `/mcp` endpoint
**still returns 503**: a complete authenticated MCP release is not implied by
publishing the authorization server groundwork.

The operator-controlled configuration requires
`BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED=true`,
`BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER=https://boardreadyops.com`,
`BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY`,
`BOARDREADYOPS_REMOTE_MCP_KEY_ID`, `SESSION_SECRET` and `DATABASE_URL`.
Never enable this flag until the rest of #1248's production security gate
has passed; RSA private keys and session/database secrets must be managed in
Doppler rather than checked into the repository. The signing key is stable
across instances, not generated per request. An invalid key or any missing
required configuration leaves *all new routes* unavailable by default.

Browser consent uses an HMAC-verified GitHub dashboard session solely to
identify the approving user. A signed-in GET creates a **pending** record and
renders a standalone HTML page displaying escaped client name, redirect
origin and requested read-only scopes. It neither grants access nor issues
an access token. The explicit Approve/Deny POST requires an active signed
session, exact same-origin `Origin`, urlencoded form and the saved unpredictable
CSRF nonce. The POST returns `303` to the exact pre-registered redirect URI
with `state` and RFC 9207 `iss`; it never sends a code via an unvalidated
redirect. Strict CSP, no-referrer, frame denial, noindex and `no-store` are
applied. Users without a session receive a sign-in link that preserves
validated OAuth request parameters across the GitHub login round-trip by means
of migration 0098's ten-minute, one-use database record and an unpredictable
HttpOnly, Secure, SameSite=Lax browser cookie. The login return path contains
only a short UUID, never the potentially long OAuth client/PKCE/state query.
After a verified GitHub sign-in, the original client request is recovered
only if the same browser supplies the corresponding cookie; the record is
atomically consumed and the cookie cleared. Expired, already used, missing
cookie, disabled client and cross-browser attempts fail closed. Every returned
consent still requires explicit POST approval and its own CSRF nonce.

This increment was validated with local route tests plus disposable PostgreSQL
integration exercising real signed browser session → rendered consent form →
CSRF-bound approval → single-use code → JWT grant. There are **no** real
ChatGPT/Claude client registrations, configured production signing keys or
production OAuth deployment migrations yet. PostgreSQL-backed rate limits
are implemented locally but not deployed. The existing gateway release hold remains.

Implementation cross-checked with RFC 9700 and the August 2026 browser-based
OAuth BCP RFC 10017. Official OpenAI plugin authorization documentation supports
predefined OAuth clients, CIMD and dynamic client registration; only the
predefined allowlist is in scope here to avoid untrusted client-metadata SSRF.

### OAuth client revocation, distributed quotas and key rollover (local increment)

Migration **0097** introduces PostgreSQL-backed, atomic one-minute rate-limit
buckets and a redacted OAuth security-event log. The authorization consent GET
has a per-authenticated-GitHub-user budget of 12 requests/minute; consent POST
has 20/minute. The token endpoint has both a global budget of 600/minute and a
40/minute budget **per enabled pre-registered client**. Throttled responses use
HTTP `429` with `Retry-After`. The global budget deliberately bounds unknown
clients before they can create arbitrarily many per-client buckets. A missing
limiter/audit database is treated as a service failure rather than bypassing
security. The shared PostgreSQL store prevents individual server replicas from
resetting quotas independently.

Each MCP bearer validation now joins the durable grant with the CURRENT
`remote_mcp_oauth_clients.enabled` state. Disabling a client therefore denies
its already-issued tokens at the next validation; a signed JWT or unexpired
grant is not sufficient by itself. Consent approvals/denials, token issuance
and user-requested revocation are logged atomically with their state-changing
SQL transactions. Other recorded events include consent creation, rejected
token exchanges and throttling. Audit records never include raw access tokens,
authorization codes, PKCE secrets, cookies or remote IP headers: client IDs are
SHA-256 digests. The existing hourly control-plane worker now schedules bounded PostgreSQL
retention passes: rate-limit buckets older than two days, redacted audit
records older than 90 days, expired authorization/code records older than one
day, and expired access grants older than two days. Each table is processed in
batches using the
worker's configured retention batch size (default 1,000, range 1–10,000),
`FOR UPDATE SKIP LOCKED` for concurrent workers, and independent failure
reporting. Deployments without either migration table skip cleanly; partial
migrations fail visibly rather than hiding schema drift.

Controlled RS256 key rollover accepts an optional Doppler-managed
`BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS` containing a conventional JSON
JWKS object `{ "keys": [...] }` with at most three previously issued **public**
RSA-2048+ signing keys. Only `kty`, `kid`, `alg`, `use`, `n`, and `e` are accepted;
unknown/private key fields, weak keys, unsupported algorithms and repeated
`kid` values fail closed. Rotate by publishing the new and old public keys
before changing the signing key used by all instances. Preserve each retired
public key for the maximum remaining 15-minute access-token lifetime plus JWKS
cache time and a clock-skew margin, then remove it. The operator is responsible
for synchronizing issuer configuration and signing keys across replicas.

Verified with actual isolated PostgreSQL 17 concurrent quota, immediate
client-disable, and sanitized audit tests and with real RSA/JWT rollover tests.
No production migrations, customer signing keys or public MCP rollout occurred.
Remaining gates include end-to-end real-client
connectivity, GitHub permission reliability and safely enabling the `/mcp`
handler; this commit does NOT enable the hosted MCP endpoint.

### Browser-bound OAuth login continuation (local acceptance)

Migration `0098_remote_mcp_oauth_login_resumptions.sql` stores validated,
pre-registered OAuth authorization request parameters for at most ten minutes,
before the user has signed in. Only a SHA-256 digest of the 32-byte browser
nonce is stored, and the pre-login record is not bound to a fabricated user ID.
The browser receives a Secure, HttpOnly, SameSite=Lax cookie restricted to
`/oauth/authorize`; GitHub's existing `return_to` remains bounded to 512
characters because it now contains only `?resume=<uuid>`. The server requires
a verified current GitHub login, the exact resumption ID, the matching browser
nonce and still-enabled exact registered OAuth client before atomically
consuming the record and displaying the permission screen. A long OAuth
`state` survives the entire login, consent and redirect sequence without
appearing in a login link. No grant is issued automatically.

The shared hourly maintenance worker deletes expired continuation rows in
bounded `SKIP LOCKED` batches, separately counts purged rows, and leaves
unexpired login attempts untouched. The migration, cookie isolation, failed
nonce, replay protection, login continuation, preserved state and retention
were exercised on an isolated PostgreSQL 17 instance. This feature remains
behind the existing unpublished OAuth and MCP rollout gates.

### Exact pre-registered OAuth client IDs (CIMD and manual public clients)

`client_id` is an opaque OAuth identifier, not intrinsically an HTTPS URL.
The authorization consent validation and authorization-code token exchange now
both accept canonical HTTPS client-metadata URLs (e.g. the verified ChatGPT
CIMD identity) **or** constrained ASCII opaque IDs (8–128 characters;
letters, digits, `.`, `_`, `~`, and `-`). This removes an avoidable
compatibility blocker for providers' manual OAuth-client configuration, such
as Claude's **Use your own OAuth client** mode. The token issuer and durable
JWT/grant checks bind the exact client ID, whichever form is configured.

Every client MUST already exist as an exact match in
`remote_mcp_oauth_clients`, have `enabled=true`, and match the requested
pre-registered canonical HTTPS `redirect_uri`. An enabled client may authorize
**only its own stored callback**. No fallback registration, wildcard callback,
CIMD fetch, remote URL dereference, or issuer/client impersonation is added.
In particular, we intentionally do **not** advertise
`client_id_metadata_document_supported: true`, because that would imply a
CIMD-fetch/validation capability we have not implemented. For manual Claude
setup, take its actual client ID and callback from the connector configuration;
do not presume the published metadata identity has been registered.

A disposable PostgreSQL integration exercises an opaque client through
single-use consent, PKCE-bound token exchange, a persisted grant and
signature-verifying access, and refuses an alternate identity, altered HTTPS
callback, malformed client ID and insecure request. No client registration,
public OAuth activation or production schema change was performed.

### Expired authorization and grant retention (migration 0099)

The hourly, PostgreSQL-backed OAuth maintenance now deletes **expired
one-use authorization/code records** only after a further one-day retention
window and **expired/revoked authorization grants** only once their normal
expiry is more than two days old. All deletions are independent per-table,
bounded to the worker's configured batch size (1–10,000), and use
`FOR UPDATE SKIP LOCKED` to avoid duplicate cleanup across replicas.
Migration `0099_remote_mcp_oauth_retention_indexes.sql` adds expiry indexes
for the authorization and grant tables, avoiding full-table expiry scans on
large hosted instances. It changes no tokens, client registrations, OAuth
feature switches or existing grant lifetimes.

The worker reports `remoteMcpExpiredGrantsPurged` and
`remoteMcpExpiredAuthorizationsPurged` as aggregate numeric counters without
exposing consent state, PKCE challenge, client ID or JWT material. Real
PostgreSQL 17 tests insert both long-expired and still-active grants and
pending authorizations, verify successive batch limits and eventual complete
purge, and prove current credentials survive. Redacted security audit records
remain on their separate **90-day** retention schedule, preserving audit
coverage after unnecessary grant/code rows have been deleted. Production
migration application and maintenance activation have **not** occurred.

### Hosted OAuth client interoperability (October 2026 review)

- OpenAI's current plugin OAuth guide documents stable ChatGPT CIMD client ID
  `https://chatgpt.com/oauth/client.json` and stable callback
  `https://chatgpt.com/connector_platform_oauth_redirect` **when the issuer
  identification contract is satisfied**. Our metadata now declares
  `authorization_response_iss_parameter_supported: true`, consistent with
  `iss` on both successful approvals and explicit user denials. This does not
  register or enable a ChatGPT client automatically. For predefined clients,
  copy the **exact production client ID and callback URI shown in the user's
  ChatGPT connector management interface** into the disabled-by-default
  allowlist, then explicitly enable that specific row after acceptance tests.
- Claude's latest custom-connector UI offers its published identity,
  automatic client registration, and user-provided OAuth client configuration.
  Dynamic client registration and metadata URL fetching remain intentionally
  unsupported in this stage. Choose a manually registered client with the
  exact Claude connector callback and client ID for the selected integration
  mode; do not guess or globally allow `claude.ai` callback patterns.
- Both providers require real OAuth and MCP tool invocations for acceptance.
  A successful synthetic consent/token exchange is not sufficient to claim
  ChatGPT or Claude connection compatibility. Never publish the protected
  `/mcp` endpoint or register a client before its boundary checks pass.

### Signed OAuth → modern MCP v2 end-to-end internal acceptance (26 October 2026)

The local PostgreSQL 17 integration suite now performs a continuous
**user-bound consent → S256 one-time authorization-code exchange → RS256 JWT →
durable grant lookup → MCP v2 `tools/list` and `tools/call`** exercise. The
MCP tool call is further gated by an injected live-repository-permission
checker. The test verifies that only the expected Review digest, SHA and
review status are serialized, that the owning repository's identity stays
private, that a removed GitHub permission returns the same generic `Review
unavailable` error as a missing Review, and that grant revocation produces
HTTP 401 with the OAuth resource metadata challenge before opening review DB.
The Review SQL adapter and permission result are **test fixtures**; the durable
OAuth authorization/grant queries run against disposable real PostgreSQL.

Review tools are no longer registered for principals with only the
`evidence:read` scope. Other scope requests remain accepted as defined by the
existing metadata and grant policy, but an evidence-only grant cannot invoke
the Review tool. The actual user-authorization boundary remains mandatory
for all Review lookups.

**Live integration boundary:** The production container has its GitHub App
configuration present and OAuth explicitly disabled. An attempted live
installation-token acceptance was refused by the connected operations tool's
security policy. No alternate means were used to obtain signing keys or
installation tokens. Prior live `gh` checks of GitHub REST user/repository/
collaborator permission endpoints used a *user CLI credential*, **not** the
GitHub App installation token. The live GitHub App permission test therefore
remains **unverified**. GitHub's official REST reference confirms these GET
endpoints support installation access tokens, with `Metadata: read` required
for the repository collaborator-permission endpoint.

OAuth clients remain unregistered and disabled in production, and actual
ChatGPT/Claude cloud connectivity is unverified. For ChatGPT, the published
stable predefined client tuple is
`https://chatgpt.com/oauth/client.json` plus
`https://chatgpt.com/connector_platform_oauth_redirect` for issuers that send
RFC 9207 `iss`. Only copy the *actual connector-managed* client and callback
from the provider UI when enabling. For Claude use the selected connector's
published client and callback; do not trust hard-coded assumptions about its
registration mode. Do not enable `/mcp`, relax authorization or claim live
provider interoperability based solely on these internal acceptance tests.

### Persistent OAuth scope binding and exact JWKS origin (pre-release hardening)

The resource server's signature verification is necessary but is not by
itself the full authorization decision. Every authenticated MCP request now
compares the **exact signed scope string** to the `scope` of the active
`remote_mcp_oauth_grants` row, in addition to matching JTI, immutable GitHub
user, client ID, issuer, audience, expiry, current client enabled status and
revocation state. An `evidence:read` consent/grant cannot be transformed into a
`review:read` grant by presenting a differently scoped JWT with the same JTI,
even when the JWT has a valid signature. Invalid or unknown scopes are denied
before data access. Real PostgreSQL tests exercise a signed mismatched-scope
bearer to confirm HTTP 401 and no Review exposure.

Production JWKS discovery is now pinned to the **exact**
`<issuer>/.well-known/jwks.json` HTTPS URL where `<issuer>` is the canonical
HTTPS origin. It rejects other same-origin paths ending in `jwks.json`, query
parameters, path-bearing issuers, untrusted hosts and insecure schemes. JWKS
configuration is not learned from untrusted JWT headers. The HTTP `/mcp`
release hold remains unchanged: no client credentials have been enrolled or
production token validation enabled yet.

### Offline-JWKS production request adapter (26 October 2026, unreleased)

`apps/web/lib/remote-mcp-production.ts` now composes the existing OAuth
issuer, the deterministic MCP v2 stateless request handler, PostgreSQL durable
grant checks, and a live GitHub App repository permission verifier. It accepts
**only trusted server-configured local JWKS** from the signing issuer, including
previous public RS256 keys during deliberate rollover. Neither JWT headers nor
client metadata may select another JWKS, issuer, tenant or verification URL.
The verification path never needs an outbound HTTP fetch to the site's own
JWKS endpoint; malformed/duplicate/private-key JWK fields fail closed.

The production-shaped handler checks the canonical `https://boardreadyops.com/mcp`
URL and exact allowed Origin **before** signature verification or PostgreSQL
lookups. JWT issuer, audience, expiry, client, GitHub subject and exact signed
scope must match an unrevoked, unexpired durable grant belonging to a currently
enabled, pre-registered client, on every MCP request. Each grant lookup opens
and closes its own database connection; permitted Review tool calls open a
separate connection, check current GitHub user and repository permissions via
the registered GitHub App and return only allowlisted read-only facts.
Unavailable/missing/unauthorized Reviews are indistinguishable to the caller;
GitHub App errors, token failures and SQL errors do not grant access.

**Two independent guards:** `BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED=true`
controls the in-process OAuth issuer; the additional
`BOARDREADYOPS_REMOTE_MCP_HANDLER_READY=true` is required before production
adapter composition, along with valid OAuth signing keys and the GitHub App
identity. `apps/web/app/mcp/route.ts` is now wired to the production-shaped
adapter, **but ONLY when both explicit flags are set to `true`** and all
OAuth/GitHub App prerequisites exist. Otherwise GET/POST/DELETE return HTTP
503, without initializing the verifier or touching the repository database.
Invalid configuration and runtime errors also fail closed to 503. Both flags
remain **disabled in production**, and no public release/deployment has been
performed. Do not set either flag in production until the final audited
enablement, actual user-specific GitHub App collaborator permission checks,
and ChatGPT/Claude OAuth/MCP client acceptance are independently verified.

Unit tests exercise real local RS256 JWT signatures, private/duplicate key
rejection, HTTP Origin/URL denial before any DB connection, repeated durable
grant lookup, revoked grants and per-call GitHub permission checks. A separate
isolated PostgreSQL 17 integration test exercises the production-shaped
adapter with persisted OAuth grants, real revocation SQL and the modern MCP v2
wire format. The **GitHub App permission outcome is injected in these tests**:
this verifies composition and fail-closed authorization, **not** the live GitHub
user-specific collaborator-permission API or provider cloud acceptance.

The paired route-gate tests enforce denied GET/POST/DELETE requests with
zero verifier setup when either flag is missing, disabled, or incorrectly set;
missing and throwing adapters also produce safe 503 responses. When both
flags are set and the adapter is successfully initialized, the route forwards
the original Request for further bearer/grant/permission checks. This is a
source-code release switch, not a declaration that the live site is enabled.

An independent operator-side read using Ops' existing `gh-boardreadyops` GitHub
App connection returned five installation repositories and successfully read
metadata for the **private** `boardreadyops/boardreadyops-e2e-private`
repository (HTTP 200; `Metadata: read`). This is useful evidence for the
installation's private repository visibility; it is **not** user-specific
collaborator permission acceptance. No GitHub private key or installation token
was extracted during this read-only check.

Direct GET/POST/DELETE probes of the existing hosted
`https://boardreadyops.com/mcp` endpoint returned **404** on 26 October 2026,
reflecting the currently deployed build/front door, NOT the new local route's
explicit 503 release-hold response. No deployment, migration, OAuth client
registration, production flag change, GitHub push, PR or merge accompanied this
increment.

### GitHub App token-issuer acceptance hardening (26 October 2026, local)

The MCP repository permission adapter now normalizes the GitHub App private key
configuration in precisely the same way as the existing BoardReadyOps GitHub
modules: a literal `\\n` escape from Doppler becomes one PEM newline. A
previous mismatch would leave escaped PEM separators intact and could prevent
Octokit from minting an installation access token. No private key is logged,
stored or exposed by this logic.

Octokit remains the default live installation-token issuer. A narrow injectable
token factory permits isolated tests to verify the exact normalized PEM input,
installation ID and three permission GET requests, without accessing real
signing keys or network tokens. Missing/revoked installation tokens fail
closed. The GitHub JSON response limit is enforced using **UTF-8 byte size**
rather than JavaScript string length, preventing oversized multibyte responses
from bypassing the 64 KiB cap when `Content-Length` is absent. The tests also
confirm response overflow fails before subsequent repository reads.

Read-only GitHub App repository metadata access has been confirmed on the
connected Ops App, and the public REST documentation confirms `GET
/user/{account_id}` and repository collaborator-permission endpoints support
installation tokens. This does **not** establish a successful real-user
collaborator-permission request through the App's installation token; that
release requirement remains open. No flags, credentials, migrations or
production deployment were changed in this increment.

### Read-only MCP release preflight (operator tool, unpublished)

From an authorized BoardReadyOps source checkout, run:

```bash
corepack pnpm run mcp:preflight
```

The command invokes `packages/db/scripts/remote-mcp-release-preflight.mjs`
with `--database`. It uses the currently available environment without
printing its values and opens an explicit PostgreSQL **read-only transaction**
to check required migration tables and 0099 expiry indexes, then inspects at
most 101 pre-registered client rows. It checks that at least one exact-match
client/callback pair is enabled; disabled-only, malformed, or overly large
registration sets fail closed. All database and signing-key errors map to fixed
JSON statuses; exception messages, credentials, PEM data, client IDs,
redirect URIs and connection strings are not written to stdout or stderr.

The same tool checks the two release switches, canonical HTTPS issuer,
minimum signed browser-session secret, at-least-2048-bit OAuth RSA signing key,
key ID, bounded public-key rotation JWKS and the configured RSA GitHub App
identity. It **never** signs an access token, calls GitHub APIs, modifies OAuth
clients, applies a migration, or writes to the database. It does not fetch
CIMD metadata or connect ChatGPT or Claude. An optional direct `node
packages/db/scripts/remote-mcp-release-preflight.mjs` invocation omits database
access entirely, explicitly marking the storage checks `not_checked`.

Its report has `schemaVersion: 1` and the permanent safety field
`publicMcpReleaseApproved: false`. Technical checks have only the values
`configured`, `blocked` or `not_checked`. Separate manual evidence gates
for **real GitHub installation-token user collaborator permission**, real
ChatGPT OAuth→MCP and real Claude OAuth→MCP always report
`manual_required`. Those gates are intentionally NOT inferred from a valid
key, an enabled client row or a local synthetic integration test. The command
exits **nonzero (1) even if every technical prerequisite passes**: do not
interpret it as a deployment approval and do not use its exit status alone
to enable `/mcp`. An invalid CLI argument exits 2.

The CLI and its pure inspector have unit tests for absent switches, malformed
signing keys, duplicate JWKS key IDs, missing migrations, disabled/wrong OAuth
client registrations, SQL failure redaction and the irrevocable manual release
hold. Separate disposable PostgreSQL 17 acceptance confirms the actual
`0095–0099` schema detection, disabled versus enabled client registration
status and read-only reporting, with no hosted data or production keys.

### Live GitHub permission HTTP stream size enforcement (unreleased)

The hosted Review's current-user permission check receives three GitHub REST
GET responses authenticated with the App **installation token**: immutable
GitHub user ID/login, immutable repository ID, and that user's current
repository collaborator permission. GitHub App installation metadata by itself
is never treated as proof of a particular user's repository access. The
connected Ops App does not expose a verified user-collaborator permission read
operation; the real installation-token user-permission release gate is still
**unverified** and cannot be inferred from the tests below.

Responses are now read incrementally from the HTTP response stream and
limited to a **total of 64 KiB per response in actual UTF-8 bytes**, not
character count or an untrusted `Content-Length` header. As soon as the limit
is exceeded the remaining body is canceled and access is denied. Early HTTP
errors and advertised oversized bodies also cancel the stream. Invalid UTF-8,
partial JSON, denied permissions, redirects, GitHub timeouts and read errors
all fail closed. Bounded chunked reading also avoids allocating attacker-sized
JSON response strings before performing the size check. The code and unit
tests use synthetic responses only; production GitHub App keys and tokens were
not read or changed.

### OAuth form request streaming limits (unreleased hardening)

`POST /oauth/token` and authenticated `POST /oauth/authorize` now share the
`remote-mcp-bounded-form` reader instead of calling unbounded `request.text()`.
It enforces **4096 bytes** at the token endpoint and **2048 bytes** for consent
decisions *while reading* the request stream, not after allocating its full
body. Any over-limit stream is canceled without consuming subsequent chunks;
none of these rejected requests can reach PostgreSQL, issue a grant, approve a
consent or run the signer. Limits use actual bytes rather than JavaScript
character counts, including for percent-encoded and multibyte text.

An absent `Content-Length` is not trusted as evidence of a small body; a
forged short value cannot bypass the incremental cap. Malformed, excessive or
mismatched declared lengths, invalid UTF-8, empty forms, interrupted streams
and already-consumed bodies fail closed. Normal valid OAuth forms retain the
same parameter allowlist, PKCE S256 validation, CSRF validation and return
semantics. The ingress must **independently** enforce transport/connection
timeouts and edge request-size controls; this application reader is not a
substitute for ingress slow-client protections.

Focused stream tests verify exact-limit requests, cancellation on oversize,
forged `Content-Length`, invalid UTF-8 and early database denial for both
OAuth endpoints. Isolated PostgreSQL 17 OAuth + retention + operator preflight
acceptance continues to pass, with no hosted configuration or production
client enrollment changed.

### GitHub App installation-token destination pinning (unreleased)

Hosted Reviews in this integration use **GitHub.com**, not an unverified
GitHub Enterprise appliance. An installation token is a credential and must
never be sent to an arbitrary HTTPS API root. The production MCP permission
adapter now permits only the canonical `https://api.github.com` endpoint
(with an optional trailing slash in the environment configuration). Any
`GITHUB_API_BASE_URL` override targeting another host, user-info URL,
nonstandard port, path, query, fragment, or insecure scheme fails closed
**before** attempting to mint an installation token or make an HTTP request.
The independent, read-only `mcp:preflight` gate applies the same exact
GitHub.com allowlist and reports a blocked App prerequisite for any deviation.

This is deliberately narrower than other legacy application components that
may support alternate GitHub API bases for separate workflows. Adding GitHub
Enterprise support to **remote MCP** would require its own approved hostname,
TLS, trust and token-isolation review; do not substitute a test endpoint or
proxy in production. Focused tests verify denied attacker-controlled API roots
cause zero token issuer and fetch calls, while the canonical root still
performs the three fixture-backed identity, repository and current-user
permission checks. No real App token or private key was accessed, and live
user-specific GitHub permission acceptance remains outstanding.

### MCP POST preauthorization header gate (unreleased)

Before performing **any JWT signature check or durable grant lookup**, the
`/mcp` verifier checks easily rejected POST headers. A noncanonical or
nonnumeric `Content-Length` receives **400**, an explicitly advertised body
larger than **65,536 bytes** receives **413**, and a missing or unsupported
JSON Content-Type receives **415**. All of these responses are `no-store` and
occur before database or GitHub access. Canonical JSON and optional UTF-8
charset headers remain compatible with the protected-resource Bearer **401**
discovery response when authorization is missing or invalid.

The SDK's separate, already-installed `maxRequestBodySize` uses the **same
65,536-byte limit** on the *actual streamed body* (including requests with no
Content-Length or a misleading smaller declaration), and returns 413 once it
receives too many bytes. The header gate is an early resource-savings check,
**not** a replacement for the SDK's byte cap or edge slow-client/connection
rate controls. It does not trust a small Content-Length as proof that the
body is small, does not parse client-controlled JSON before authenticating the
request, and does not bypass the signed OAuth grant or current-user GitHub
permission checks for Review reads.

Unit tests verify forged, malformed and oversized declared lengths, invalid
media types, valid JSON media parameters, the missing-token OAuth challenge,
and the SDK's streamed-body limit. They explicitly assert zero verifier and
PostgreSQL calls for early rejected input. The dual release feature gates
remain disabled in production; no deployment or client enrollment occurred.
