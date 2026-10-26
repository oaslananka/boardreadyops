# BoardReadyOps #1248 — live acceptance evidence, 26 October 2026

**Release decision: HOLD. Do not enable, push, PR, merge, migrate production,
or deploy `/mcp` on the strength of this report.**

## Checks actually performed

1. **GitHub App installation, read-only GraphQL:** using the existing
   `gh-boardreadyops` connected installation, the private
   `boardreadyops/boardreadyops-e2e-private` repository was visible (`HTTP 200`).
   The authenticated **installation** GraphQL `repository.collaborators`
   result included the `boardreadyops` user with `ADMIN` repository permission.
   Both immutable GitHub user and repository numeric identifiers were present.
   A separate **user-token** GraphQL read reported `viewerPermission: ADMIN`
   for the same private repository. These are *live responses*, not mock fixtures.
2. **What item 1 does not prove:** the deployed BoardReadyOps MCP implementation
   uses GitHub App REST installation-token calls to `/user/{id}`, repository ID
   lookup, and `/collaborators/{login}/permission`. Those exact REST requests
   have **not** been run together against the production application. The
   underlying Repo/Review authorization path, an actual Reviews read and any
   ChatGPT/Claude exchange still require separate acceptance.
3. **Existing public site (GET probes):**
   `https://boardreadyops.com/mcp`,
   `https://boardreadyops.com/.well-known/oauth-protected-resource/mcp`,
   `https://boardreadyops.com/.well-known/oauth-authorization-server`,
   `https://boardreadyops.com/oauth/authorize`, and
   `https://boardreadyops.com/oauth/connections` all returned **404**.
   This describes the currently deployed site, not the local feature branch,
   where MCP is disabled-by-default with **503**.
4. **Local repository preflight without production credentials:** the
   `remote-mcp-release-preflight.mjs` report returned
   `publicMcpReleaseApproved: false`, both release flags blocked, OAuth and
   App signing prerequisites unconfigured in this test shell, and database/client
   registration inspection `not_checked`. This is **not** evidence that
   production secrets or production client registrations are absent.
5. **Interactive connector test access:** Ops browser control on
   `amd2700x-ubuntu-chrome` reported *"Browser control is paused by the user on
   this device"*. Respect this user setting. Do not switch to another user
   browser to evade the pause. Once the user resumes browser control, re-check
   browser task access before any OAuth provider configuration, and obtain
   explicit user authentication/consent when the provider requires it.

## Still-blocking release requirements

- Audit exact GitHub App REST installation-token permission checks and live
  MCP Review tool access for the intended account/repository.
- Determine **actual** registered ChatGPT and Claude client IDs and exact
  OAuth redirect URIs from the providers; explicitly pre-register only approved
  clients. Do not invent callbacks or enable DCR/CIMD fetch.
- Provision the required OAuth issuer signing/session/GitHub App configuration
  through authorized secret management, apply reviewed migrations through 0100,
  and confirm preflight readiness without exposing any secret values.
- Review edge WAF/connection and request-rate protections, signing-key rollover,
  and independent cloud-origin access from OpenAI and Anthropic networks.
- Run and document real ChatGPT and Claude OAuth authorization, S256 code
  exchange, read-only MCP Review call, revoked-grant rejection, and denial for
  users without current repository permission.
- Explicitly approve the controlled rollout **after** these checks. Never
  interpret local tests, installed App metadata or this document as a public
  go-live authorization.

**User action needed now:** resume previously paused Ops browser control on
`amd2700x-ubuntu-chrome` if browser automation is desired. Later browser-based
GitHub/ChatGPT/Claude sign-in or consent may need the user's interaction.
No GitHub or cloud service credentials need to be copied into chat.

## MSI browser acceptance follow-up (user-authorized alternative browser)

The user explicitly authorized attempting the same acceptance workflow using
`msi-chrome` rather than the separate AMD browser whose control had been
paused. The MSI Chrome device was online and browser automation succeeded.
Existing BoardReadyOps and KiHub tabs were left untouched; new task tabs
were used for the checks below.

- **BoardReadyOps:** Chrome showed the authenticated BoardReadyOps Cloud
  navigation on `https://boardreadyops.com/mcp`, followed by **Page not found**.
  There is no publicly deployed MCP route to authorize against yet.
- **ChatGPT:** the browser account was signed in (Plus). Plugins → Add →
  Add custom MCP server was available; a non-persisted draft for the canonical
  `https://boardreadyops.com/mcp` server was used to inspect advanced OAuth
  settings. **OAuth discovery failed** for the not-yet-deployed endpoint.
  User-defined OAuth Client setup is visible, including a generated callback
  field, while the other registration approaches were unavailable in this
  state. Exact callback must be collected again from the final creation flow;
  don't treat the uncommitted, generated draft callback as permanent. The
  draft dialog was closed **without creating a plugin or OAuth connection**.
- **Claude:** the browser was signed in (Free). Settings → Connectors listed
  existing connected services, but its **Add custom connector** item was
  disabled. Its exact account/feature eligibility blocker was not disclosed
  by the page. No plan change or connector creation was attempted.

**Revised user action:** the AMD browser does not need to be resumed for MSI
browser acceptance. Do not request credential sharing. First deploy the
reviewed, gated `/mcp` and OAuth metadata routes through an authorized
release path while keeping the handler disabled until prerequisites pass;
then discover callback/client IDs with the providers and complete the
browser-controlled OAuth tests. If Claude's custom connector option remains
disabled, resolve its account eligibility/plan restrictions with the owner,
without assuming a paid upgrade is the only solution. Production remains on
release HOLD; MSI browser access alone does not authorize deployment.
