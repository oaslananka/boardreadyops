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
- **Fail-Closed Secret Enforcement**: If the webhook secret is not configured, the endpoint immediately returns HTTP 503 so GitHub safely retries.
- **Delivery Idempotency**: Deliveries are tracked by `X-GitHub-Delivery`. Replayed deliveries are idempotently accepted without duplicate database mutations.
- **Tenant Boundary Isolation**: Mutations are strictly scoped to `account.login`.

---

## 6. Marketplace Webhook Lifecycle (`marketplace_purchase`)

When GitHub sends `marketplace_purchase` events, BoardReadyOps handles the following actions:

| Action | Description | Behavior |
| --- | --- | --- |
| `purchased` | A customer installs / activates the Community plan. | Upserts customer record and synchronizes `installations.plan_tier` to `free` (or `trialing` if on free trial). |
| `changed` | A customer modifies their plan tier. | Re-evaluates plan mapping and updates customer tier. |
| `cancelled` | A customer cancels the Marketplace plan. | Sets customer status to `canceled` and resets `installations.plan_tier` to `free`. |
| `pending_change` | A customer schedules a future plan change. | Records the event for operational proof without immediate state mutation until effective. |
| `pending_change_cancelled` | A customer cancels a scheduled change. | Acknowledges event and records audit trail. |
| `ping` | Webhook setup verification from GitHub. | Returns `200 OK` with `{ ok: true, status: "accepted" }`. |

---

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
- `503`: Webhook secret missing or database persistence transiently unavailable (GitHub will retry).

---

## 8. Known Lifecycle Limitations

- Automated data deletion requests must be initiated via GitHub issues or repository uninstallation.
- For additional architectural details and data lifecycle policies, refer to [Data Lifecycle & Privacy](security/data-lifecycle.md).
