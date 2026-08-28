# GitHub Marketplace Integration & Listing Guide

This document describes the GitHub Marketplace integration, listing configuration, and webhook lifecycle for BoardReadyOps.

---

## 1. Overview & Marketplace Listing

BoardReadyOps is listed on GitHub Marketplace as a **Continuous Integration** and **Code Quality** app providing automated KiCad hardware readiness checks.

- **Primary Category**: Continuous integration
- **Secondary Category**: Code quality
- **Published Plan**: **Community (Free)**
- **Public Service URL**: [https://boardreadyops.com/](https://boardreadyops.com/)

---

## 2. Listing URLs & Public Contracts

| Resource | URL |
| --- | --- |
| **Privacy Policy** | [https://github.com/oaslananka/boardreadyops/blob/main/PRIVACY.md](https://github.com/oaslananka/boardreadyops/blob/main/PRIVACY.md) |
| **Terms of Service** | [https://github.com/oaslananka/boardreadyops/blob/main/TERMS.md](https://github.com/oaslananka/boardreadyops/blob/main/TERMS.md) |
| **Support & Issues** | [https://github.com/oaslananka/boardreadyops/issues](https://github.com/oaslananka/boardreadyops/issues) |
| **Product Documentation** | [https://github.com/oaslananka/boardreadyops#readme](https://github.com/oaslananka/boardreadyops#readme) |
| **Security Reporting** | [https://github.com/oaslananka/boardreadyops/security/advisories/new](https://github.com/oaslananka/boardreadyops/security/advisories/new) |
| **Marketplace Webhook Endpoint** | `https://boardreadyops.com/api/github/marketplace/webhook` |

---

## 3. Plans & Capabilities

### Community (Free) Plan
- **Price**: \$0 / month (Free)
- **Features**:
  - Automated PR checks and readiness scoring on KiCad commits.
  - ERC / DRC rule enforcement and fabrication linting.
  - Single watched board for supply tracking.
  - Interactive report artifact generation.
  - Standard 30-day retention on run summaries.

The hosted Marketplace offering is intentionally free-only. Authenticated calls to the legacy external Stripe checkout and customer-portal endpoints return HTTP 410 with code `marketplace_free_only` while Community is the published Marketplace plan; no external paid subscription path is exposed for this listing. The underlying provider-neutral billing contracts and Stripe webhook primitives remain in the codebase for historical data handling and a future paid Marketplace migration.

---

## 4. GitHub App Permissions Overview

When users install BoardReadyOps from GitHub Marketplace, the GitHub App requests minimal required repository permissions:

| Permission | Access | Justification |
| --- | --- | --- |
| **Checks** | Read & write | Create and update Check Runs with pass/fail release readiness results on pull requests and commits. |
| **Pull Requests** | Read | Identify target branch, PR numbers, and compare base/head revisions. |
| **Contents** | Read | Inspect KiCad project files (`.kicad_pro`, `.kicad_sch`, `.kicad_pcb`), BOMs, and jobsets during review runs. |
| **Metadata** | Read-only | Core GitHub App requirement to resolve repository name, owner, and default branch. |

---

## 5. Webhook Endpoints & Architecture

BoardReadyOps maintains two isolated webhook endpoints with separate secrets and routing boundaries:

1. **GitHub App Lifecycle Webhook**:
   - Path: `POST /api/github/webhook`
   - Secret: `GITHUB_WEBHOOK_SECRET`
   - Handles: `installation`, `installation_repositories`, `pull_request`, `ping`.
2. **GitHub Marketplace Webhook**:
   - Path: `POST /api/github/marketplace/webhook`
   - Secret: `GITHUB_MARKETPLACE_WEBHOOK_SECRET`
   - Handles: `marketplace_purchase`, `ping`.
   - Content-Type: `application/json`

### Webhook Security Controls
- **HMAC-SHA256 Signature Verification**: Verified using constant-time digest comparison against `X-Hub-Signature-256`.
- **Bounded Request Intake**: Request bodies are bounded to 2 MB to prevent memory exhaustion and DoS attacks.
- **Fail-Closed Secret Enforcement**: If the webhook secret or durable PostgreSQL persistence is unavailable, the endpoint returns HTTP 503 and does not acknowledge the Marketplace state change as completed.
- **Delivery Idempotency**: Deliveries are tracked by `X-GitHub-Delivery`. Duplicate deliveries are acknowledged without repeating state changes.
- **Provider Isolation**: Marketplace state is stored separately from Stripe billing records and from GitHub App installation lifecycle state. A Marketplace event cannot grant `team` or `business` entitlements while the published listing is Community (Free).
- **Out-of-Order Protection**: A newer `effective_date` may advance Marketplace state. At the same timestamp, cancellation is authoritative and a purchase cannot reopen a canceled account.
- **Minimized Persistence**: The raw webhook body is not stored. Only bounded Marketplace metadata needed for lifecycle processing and auditability is persisted.

GitHub does not automatically redeliver failed Marketplace webhook deliveries. Operators must monitor failed deliveries and use GitHub's Marketplace webhook delivery page to redeliver a failed event after the underlying outage is corrected.

---

## 6. Marketplace Webhook Lifecycle (`marketplace_purchase`)

The Marketplace listing currently publishes one plan: **Community (Free)**. Marketplace payload plan names are therefore never trusted to grant paid BoardReadyOps entitlements.

| Action | Behavior |
| --- | --- |
| `purchased` | Activates the account's provider-specific Marketplace state at the event `effective_date`; the stored Marketplace tier remains `free`. |
| `cancelled` | Marks the Marketplace account state `canceled` at the event `effective_date`, atomically revokes BoardReadyOps repository API tokens for the account, blocks repository/session surfaces and new GitHub App lifecycle jobs, and queues an account-scoped erasure request (organization or user, matching the Marketplace account type) with a deadline 30 days after that effective date. Active legal holds block deletion and are recorded as such. |
| `changed` | Records the delivery for auditability but does not grant a paid entitlement while the listing is Free-only. |
| `pending_change` / `pending_change_cancelled` | Records and acknowledges the pending lifecycle delivery without changing current service state. |
| Other actions | Records the valid signed delivery and safely acknowledges it without applying an entitlement mutation. |
| `ping` | Verifies webhook reachability and signature configuration without touching Marketplace state. |

Marketplace delivery persistence and current-state mutation are executed in one PostgreSQL statement, so a database failure cannot leave a delivery recorded as complete while its state mutation is missing. A later-delivered event with an older `effective_date` is retained as processed evidence but cannot roll current state backward.

Cancellation creates a durable account-scoped erasure request and deactivates Marketplace-backed hosted access immediately. Repository API tokens for the account are revoked in the same database statement as the non-stale cancellation state change. Dashboard repository/installation/run queries and repository-scoped API authorization fail closed when the account is canceled, and later GitHub App lifecycle webhooks are acknowledged without producing control-plane jobs.

BoardReadyOps does not persist the transient GitHub user OAuth access token used during dashboard sign-in; it is used to resolve the viewer and installation list and then discarded. There is therefore no stored GitHub user OAuth credential to revoke on Marketplace cancellation. Existing signed BoardReadyOps sessions carry no GitHub access token and lose repository authorization through the canceled Marketplace state check.

Erasure **execution** is an operator lifecycle responsibility today; it is not represented as an automated purge. Operators must complete or lawfully block the request before its persisted `due_at` deadline and account for backups/platform logs under the separate operator retention policy.

## 7. Troubleshooting & Verification

### Webhook Verification via Curl
You can verify the production endpoint using an HMAC-SHA256 signature generated with your configured secret:

```bash
# Example signature verification (dry-run)
BODY='{"action":"purchased"}'
SECRET="your_marketplace_webhook_secret"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST https://boardreadyops.com/api/github/marketplace/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-GitHub-Delivery: test-delivery-001" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$BODY"
```

### Expected Response Codes
- `200 / 202`: Successfully accepted / processed.
- `400`: Invalid headers, malformed JSON, or missing required fields.
- `401`: Invalid signature (unauthorized).
- `413`: Payload size exceeds 2 MB.
- `503`: Webhook secret missing or durable database persistence unavailable. GitHub Marketplace does not automatically retry failed deliveries; correct the outage and redeliver the failed delivery from the Marketplace webhook delivery UI.

---

## 8. Known Lifecycle Limitations

- Marketplace cancellation creates an account-scoped erasure request with a 30-day deadline, but physical/database erasure execution is still an operator workflow rather than an automatic background purge.
- General age-based deletion for release runs, findings, audit evidence, and all managed artifacts is not yet implemented.
- Backup and infrastructure-log expiry remain operator responsibilities and must be handled separately from application-level erasure.
- For the full implemented boundary and current gaps, refer to [Data Lifecycle & Privacy](security/data-lifecycle.md).
