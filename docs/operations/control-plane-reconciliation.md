# Control-plane Reconciliation and Dead-letter Operations

BoardReadyOps stores lifecycle jobs, external side effects, and reconciliation work in PostgreSQL. The operator API provides a bounded, metadata-only surface for diagnosing dead letters and replaying records that the database has classified as safe.

## Security boundary

The operator API is disabled unless both server-side settings are present:

```dotenv
BOARDREADYOPS_OPERATOR_API_TOKEN=<at-least-32-visible-ASCII-characters>
BOARDREADYOPS_OPERATOR_ACTOR_ID=operator.primary
```

Generate a high-entropy token with an approved secret-management workflow, for example:

```bash
openssl rand -base64 48
```

Store the token in the deployment secret manager. Do not commit it, print it in CI, place it in a URL, or reuse a GitHub credential. `BOARDREADYOPS_OPERATOR_ACTOR_ID` is a stable, non-secret audit identity and must contain only letters, digits, `.`, `_`, `:`, or `-`.

Expose these endpoints only through a private network, authenticated administrative proxy, or equivalent restricted operations boundary. The bearer token is an application control, not a replacement for network isolation, TLS, request logging policy, or operator access review.

Requests authenticate with:

```http
Authorization: Bearer <BOARDREADYOPS_OPERATOR_API_TOKEN>
```

Authentication uses constant-time comparison after byte-length validation. The configured actor identifier is written to replay operations; callers cannot choose the audit actor in a request body or header.

## List tenant dead letters

```http
GET /api/v1/operator/installations/{installationId}/dead-letters
```

Optional query parameters:

- `limit`: integer from 1 through 100; default `50`.
- `before`: ISO-8601 timestamp returned as `nextBefore` by the preceding page.

Example:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer ${BOARDREADYOPS_OPERATOR_API_TOKEN}" \
  "https://boardreadyops.example/api/v1/operator/installations/${INSTALLATION_ID}/dead-letters?limit=50"
```

The response contains bounded operational metadata such as item type, item identifier, repository name, stable reason code, error class, attempt count, failure time, and whether replay is safe. It never includes webhook actions, outbox payloads, source content, findings, credentials, or raw database errors.

Cross-tenant identifiers are not disclosed. PostgreSQL resolves every row through the supplied installation scope.

## Replay one safe dead letter

```http
POST /api/v1/operator/installations/{installationId}/dead-letters/{itemType}/{itemId}/replay
```

`itemType` is `job` or `outbox`. Every replay requires a unique, caller-generated idempotency key:

```bash
OPERATION_ID="$(uuidgen)"
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${BOARDREADYOPS_OPERATOR_API_TOKEN}" \
  --header "Idempotency-Key: ${OPERATION_ID}" \
  "https://boardreadyops.example/api/v1/operator/installations/${INSTALLATION_ID}/dead-letters/job/${ITEM_ID}/replay"
```

Successful replay returns `replayed`. Retrying the same operation ID with the same installation, item type, and item ID returns `already_applied` and the same audit event identifier. Reusing an operation ID for a different request is rejected by PostgreSQL.

Outcome mapping:

| HTTP status | Outcome | Operator action |
| --- | --- | --- |
| `200` | `replayed` or `already_applied` | Record the returned audit event ID and watch queue/outbox health. |
| `404` | `not_found` | Confirm installation scope and item ID; no ownership information is disclosed. |
| `409` | `not_replayable` | Reconciliation or manual incident handling is required. Do not force a duplicate external side effect. |
| `503` | unavailable | Restore operator configuration or database health before retrying with the same idempotency key. |

A replay that changes state writes a `control_plane.dead_letter_replayed` audit event. The event binds the installation, configured actor, operation ID, item type, and item ID without persisting tenant payload content.

## Replay checklist

Before replaying:

1. confirm the installation and repository scope;
2. classify the stable failure reason;
3. verify that the row reports `replaySafe: true`;
4. ensure the external side effect cannot already have succeeded without acknowledgement;
5. create one operation ID and preserve it for all retries; and
6. record the returned audit event ID in the incident timeline.

Workflow dispatches with uncertain delivery remain non-replayable until installation-scoped GitHub reconciliation proves the authoritative workflow state.

## Credential rotation

Rotate the operator token through the secret manager and deployment platform. During rotation, deploy the new value atomically; requests using the previous token must begin returning `401`. Keep the actor ID stable when the same operator identity continues to own the action. Change it when responsibility transfers so later audit events remain attributable.

After rotation, verify an authenticated list request, an unauthenticated `401`, and the absence of bearer values in application, proxy, and tracing logs.
