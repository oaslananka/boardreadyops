# Web Server Library Instructions

These instructions apply to `apps/web/lib/**` and supplement the root and Next.js instructions.

This directory contains server-side authorization, tenant scoping, GitHub mutations, workers, billing/storage adapters, runner request authentication, and control-plane orchestration. Treat changes here as control-plane changes.

## Authority model

Authentication is not authorization.

- A valid session, API token, runner signature, webhook, or operator credential proves only the identity represented by that credential.
- Repository, installation, workspace, run, review, artifact, delivery, and runner authority must be resolved or revalidated server-side.
- Do not trust hidden form fields, route IDs, request-body tenant IDs, repository names, or caller-selected installation/workspace identifiers as authorization evidence.
- Preserve not-found behavior where it intentionally prevents cross-tenant existence disclosure.
- Reuse canonical tenant and workspace authorization helpers rather than copying predicates into new routes.

## Secrets and errors

- Never log or return signing material, tokens, webhook signatures, signed capabilities, lease tokens, OAuth secrets, database URLs, provider credentials, or raw private source.
- User-facing failures receive bounded safe categories/messages and a correlation ID when operational diagnosis is needed.
- Internal telemetry may keep a bounded error code/class and correlation metadata, not raw credential or source data.
- Do not surface raw database/provider/process exceptions directly to customers.

## GitHub and control-plane mutations

- Derive installation/repository scope from authoritative persisted state.
- Keep GitHub mutation retries idempotent and bounded.
- Preserve transactional-outbox, lifecycle-transition, and reconciliation ownership; do not add a second ad hoc writer for protected control-plane state.
- Worker loops must preserve lease/idempotency semantics and bounded retry/dead-letter behavior.

## Runner requests

Signed runner requests remain bound to canonical method/path/body plus the expected run/attempt/lease context.

- Preserve timestamp tolerance and nonce/replay defenses.
- Do not accept caller-selected run or attempt identifiers as authority merely because a signature is valid.
- Managed and self-hosted identity classes remain explicit.

## Verification

Run focused web tests, web typecheck, and relevant cloud coverage/integration gates. Authorization or worker-transition changes normally require PostgreSQL-backed integration evidence in CI.
