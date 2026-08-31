# Standard Security Questionnaire Responses: BoardReadyOps

*Reference Documents: `SECURITY.md`, `docs/security/threat-model.md`, `docs/architecture/contract-versioning.md`*
*Classification: Public Standard Response Document for Enterprise InfoSec Reviews.*

---

## 1. Company & Product Overview

| Security Dimension | Response |
| :--- | :--- |
| **Product Name** | BoardReadyOps |
| **Product Architecture** | Local-first CLI & GitHub Action with optional zero-knowledge control plane. |
| **Hosting Model** | Customer-hosted (GitHub Actions runners / local workstations) + a self-hosted Docker Compose control plane (PostgreSQL + web + worker) that the customer or BoardReadyOps operates, for optional team sync. See [Self-hosted deployment](../deployment/self-hosted.md). An earlier design (ADR-0008) proposed Vercel for this role; the project deployed self-hosted instead. |
| **Data Classification** | Low / Metadata only. No hardware design files (schematics, PCB layouts, netlists) are stored or processed in the SaaS control plane. |

---

## 2. Data Protection & Privacy

### Q1: Are customer CAD / EDA design files stored or processed in your cloud?
**No.** All parsing, geometric clearance checks, rule evaluation, and artifact generation occur strictly within the customer's local machine or GitHub Actions runner. Only structured assessment metadata (e.g., readiness score, rule IDs, cryptographic finding fingerprints) is optionally synchronized.

### Q2: What encryption standards are used for data in transit and at rest?
- **In Transit**: All HTTP/API communications use TLS 1.3 (minimum TLS 1.2). GitHub webhooks and Stripe webhooks are verified with HMAC-SHA256 signatures.
- **At Rest, application-level**: Sensitive installation credentials are encrypted at the column level with AES-256-GCM (authenticated encryption; `packages/cloud-core/src/credential-encryption.ts`) before being written to PostgreSQL. Cryptographic release bundles are signed using Ed25519 asymmetric keys.
- **At Rest, storage volume**: Whole-database and disk-level encryption depends on the underlying host/storage the control plane is deployed on (the customer's or BoardReadyOps's own infrastructure choice for the self-hosted deployment) — BoardReadyOps does not itself guarantee volume-level encryption; confirm this with whoever operates the deployment's storage.

### Q3: How is tenant isolation enforced in multi-tenant environments?
Tenant isolation is enforced through two layers, both application-level (PostgreSQL Row-Level Security is **not** currently implemented — every migration was checked, none define `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`):
1. **Foreign-Key Scoping**: Every database query scopes access by `installation_id` and `tenant_id`.
2. **Artifact Path Containment**: Storage keys are strictly validated and scoped to prevent directory traversal (`..`).

Adding database-engine-level RLS as a defense-in-depth layer is `planned`, not `available`.

---

## 3. Vulnerability Management & Incident Response

### Q4: How are software dependencies managed and audited for vulnerabilities?
- **Automated Scanning**: Nightly and per-commit automated dependency vulnerability audits via `pnpm audit` and Dependabot / Renovate.
- **SAST & Linting**: Automated static analysis using Semgrep, Biome, and SonarQube.
- **Supply Chain Security**: All release packages are signed, and production builds use pinned lockfiles (`pnpm-lock.yaml`).

### Q5: How do external researchers report security vulnerabilities?
Vulnerabilities are reported via [GitHub Security Advisories](https://github.com/oaslananka/boardreadyops/security/advisories/new) (preferred) or, for low-severity/hygiene issues, a public issue tagged `security` — see [`SECURITY.md`](../../SECURITY.md). There is no separate security email address; GitHub Security Advisories is the only channel. Initial response targets are severity-tiered, not a flat number: Critical 24h, High 48h, Medium 72h, Low 7 days (remediation targets: 7/14/30 days, next release, respectively).

---

## 4. Compliance & Access Control

### Q6: What certifications are held by BoardReadyOps?
- **Current State**: BoardReadyOps holds no SOC 2 or ISO 27001 certification today. Both are `planned`, not in active audit — do not represent either as in progress to a prospect until an auditor engagement actually exists.
- **Infrastructure**: The control plane is self-hosted (customer's or BoardReadyOps's own Docker Compose deployment, see [Self-hosted deployment](../deployment/self-hosted.md)), not a third-party PaaS. Any compliance posture of the underlying infrastructure is a property of whoever operates that deployment's hosting/storage, not a certification BoardReadyOps can assert on their behalf.
