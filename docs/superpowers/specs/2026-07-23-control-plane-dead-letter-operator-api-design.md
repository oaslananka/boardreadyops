# Control-Plane Dead-Letter Operator API Design

## Context

Issue #190 requires tenant-scoped dead-letter listing, safe replay, and auditability. The PostgreSQL foundation already exposes `listDeadLetters` and `replayDeadLetter`, enforces installation ownership, rejects unsafe workflow-dispatch replay, records idempotent replay operations, and writes audit events. The missing boundary is an authenticated operator surface.

## Scope

This slice adds an internal HTTP API for BoardReadyOps operators. It does not add end-user administration, organization roles, dashboard UI, bulk replay, payload inspection, or a new identity provider.

Endpoints:

- `GET /api/v1/operator/installations/{installationId}/dead-letters`
- `POST /api/v1/operator/installations/{installationId}/dead-letters/{itemType}/{itemId}/replay`

The list endpoint accepts bounded `limit` and `before` query parameters and returns metadata only. The replay endpoint requires an `Idempotency-Key` header and returns the database replay outcome plus the audit event identifier when one exists.

## Authentication and Authorization

The API is disabled unless both of these server-side values exist:

- `BOARDREADYOPS_OPERATOR_API_TOKEN`
- `BOARDREADYOPS_OPERATOR_ACTOR_ID`

Requests use `Authorization: Bearer <token>`. Token comparison is constant-time after length validation. The configured actor identifier, not a request header or request body, is written to the replay operation and audit event.

The caller supplies the installation identifier in the path, but PostgreSQL functions enforce that listed and replayed records belong to that installation. Cross-tenant item identifiers return `not_found` without revealing ownership.

## Response and Failure Contract

All responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

- Missing or invalid bearer token: `401`.
- Operator API not configured: `503`.
- Database not configured or temporarily unavailable: `503`.
- Invalid identifiers, item type, pagination, or idempotency key: `400`.
- Replay target not found in the installation: `404`.
- Replay target exists but is unsafe or no longer replayable: `409`.
- Successful or idempotently repeated replay: `200`.

Responses never include outbox payloads, webhook actions, source content, findings, credentials, or raw error messages. Listing exposes only the existing bounded metadata contract.

## Components

`apps/web/lib/control-plane-operator-auth.ts` owns configuration validation and bearer authentication.

`apps/web/lib/control-plane-dead-letter-routes.ts` owns request validation, database-store construction, response mapping, and dependency injection for tests.

Thin Next.js route files only resolve dynamic path parameters and delegate to the handlers.

## Testing

Unit tests cover disabled configuration, missing and invalid authentication, constant-time-compatible exact authentication, bounded list pagination, metadata-only responses, required idempotency keys, installation-scoped replay calls, status mapping, and database failures. Existing PostgreSQL tests remain the authority for tenant isolation, idempotency, replay safety, and audit-event persistence.

## Operational Configuration

`deploy/env.example` and the control-plane operations documentation describe generating a high-entropy token, keeping the endpoint private at the network layer, rotating credentials, and using a stable non-secret actor identifier. The bearer token is never logged or persisted.
