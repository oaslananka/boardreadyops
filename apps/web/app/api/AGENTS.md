# Web API Route Instructions

These instructions apply to `apps/web/app/api/**` and supplement the repository root, Next.js, and `apps/web/lib/AGENTS.md` instructions.

API routes are transport boundaries. They parse untrusted input and delegate to canonical authorization/domain/store helpers; they do not become a second policy engine.

## Request handling

- Use a bounded request body before parsing uploads, JSON, CSV, webhook payloads, or other attacker-controlled content.
- Validate route params, headers, query values, content type, and body shape explicitly.
- Reject unknown/unsupported states rather than inferring a permissive default.
- Preserve exact-byte digests/signature verification when a webhook or provenance contract depends on raw request bytes.

## Authentication and authorization

- Authenticate through the canonical route helper for the credential class.
- Perform server-side authorization for the exact repository/workspace/installation/run/review/artifact after authentication.
- A route ID or request-body owner/tenant field is never sufficient authority.
- Operator endpoints stay operator-only; runner endpoints stay runner-signed; GitHub webhooks stay signature-verified.

## Mutation safety

- Preserve idempotency/replay contracts for webhook, result, billing, lifecycle, runner, and import endpoints.
- Destructive operations require the documented preconditions and authorization checks.
- Cross-tenant not-found semantics must not regress into identifier enumeration.
- Do not perform unrelated side effects before validation/authorization succeeds.

## Responses

- Return stable bounded errors; do not leak SQL, provider internals, secrets, source content, or stack traces.
- Preserve correlation IDs where the UI/support contract uses them.
- Public API contract changes require focused tests and documentation/schema updates.

## Verification

Run focused route/auth tests, web typecheck, cloud coverage, and relevant integration suites.
