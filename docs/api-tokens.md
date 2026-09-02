# API tokens

BoardReadyOps Cloud supports long-lived API tokens for scripts, CI systems, and integrations that need to call the [`/api/v1`](https://github.com/oaslananka/boardreadyops) REST API without a browser session. Tokens are scoped per repository and start with the prefix `bro_live_`.

## Creating a token

Send a `POST` request to `/api/v1/tokens`, authenticated as a user with `admin` scope on the repository (a signed-in browser session or an existing `admin`-scoped token):

```bash
curl -X POST https://app.boardreadyops.com/api/v1/tokens \
  -H "Authorization: Bearer $BOARDREADYOPS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryId": "repo_123",
    "name": "CI publish token",
    "scopes": ["runs:write", "reviews:read"],
    "durationDays": 90
  }'
```

| Field | Required | Description |
| --- | --- | --- |
| `repositoryId` | Yes | The repository the token is scoped to. |
| `name` | Yes | A label to identify the token later (shown in `GET`/list, not secret). |
| `scopes` | No | Array of `runs:write`, `reviews:read`, `reviews:write`, `admin`. Defaults to `["runs:write", "reviews:read", "reviews:write"]`. |
| `durationDays` | No | 1–365. Omit for a token that never expires. |

The response includes the full token value exactly once:

```json
{
  "ok": true,
  "token": "bro_live_3f9a1c...",
  "tokenRecord": {
    "id": "tok_...",
    "name": "CI publish token",
    "tokenPrefix": "bro_live_3f9a1c",
    "scopes": ["runs:write", "reviews:read"],
    "expiresAt": "2026-12-01T00:00:00.000Z",
    "createdAt": "2026-09-02T00:00:00.000Z"
  }
}
```

Store the `token` value immediately (for example, as a CI secret) — BoardReadyOps only stores a SHA-256 hash of it, not the plaintext, so it cannot be retrieved again. If it's lost, revoke it and create a new one.

## Scopes

| Scope | Grants |
| --- | --- |
| `runs:write` | Publish run results and evidence (used by the CLI/Action's `review publish` and cloud-upload paths). |
| `reviews:read` | Read review state, findings, and decisions. |
| `reviews:write` | Record review decisions, approvals, and waivers. |
| `admin` | Manage repository settings and API tokens themselves (create/list/revoke). Required to call `POST`/`GET`/`DELETE /api/v1/tokens`. |

A token can hold multiple scopes; requests are rejected with `403` if the token lacks the scope the endpoint requires.

## Using a token

Pass it as a standard bearer token on every request:

```bash
curl https://app.boardreadyops.com/api/v1/runs \
  -H "Authorization: Bearer bro_live_3f9a1c..."
```

## Listing tokens

```bash
curl https://app.boardreadyops.com/api/v1/tokens?repositoryId=repo_123 \
  -H "Authorization: Bearer $BOARDREADYOPS_ADMIN_TOKEN"
```

Returns each token's metadata (name, prefix, scopes, expiry, last-used time) — never the plaintext value.

## Revoking a token

```bash
curl -X DELETE "https://app.boardreadyops.com/api/v1/tokens?tokenId=tok_..." \
  -H "Authorization: Bearer $BOARDREADYOPS_ADMIN_TOKEN"
```

Revocation is immediate and permanent; a revoked token's requests are rejected regardless of its `expiresAt`.

## Security notes

- Treat a token exactly like a password — anyone with it can act with its scopes against the repository it's bound to, until it's revoked or expires.
- There is currently no built-in rotation reminder or expiry notification; tokens created without `durationDays` never expire on their own, so prefer setting an expiry for anything other than a long-lived service integration, and revoke tokens you no longer use.
- Tokens are not visible per-device or per-session — revoking one affects every place it's used.
