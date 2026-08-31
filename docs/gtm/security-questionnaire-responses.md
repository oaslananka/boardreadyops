# Standard Security Questionnaire Responses: BoardReadyOps

*Reference Documents: `SECURITY.md`, `docs/security/threat-model.md`, `docs/architecture/contract-versioning.md`*
*Classification: Public Standard Response Document for Enterprise InfoSec Reviews.*

---

## 1. Company & Product Overview

| Security Dimension | Response |
| :--- | :--- |
| **Product Name** | BoardReadyOps |
| **Product Architecture** | Local-first CLI & GitHub Action with optional zero-knowledge control plane. |
| **Hosting Model** | Customer-hosted (GitHub Actions runners / local workstations) + Vercel/PostgreSQL control plane for optional team sync. |
| **Data Classification** | Low / Metadata only. No hardware design files (schematics, PCB layouts, netlists) are stored or processed in the SaaS control plane. |

---

## 2. Data Protection & Privacy

### Q1: Are customer CAD / EDA design files stored or processed in your cloud?
**No.** All parsing, geometric clearance checks, rule evaluation, and artifact generation occur strictly within the customer's local machine or GitHub Actions runner. Only structured assessment metadata (e.g., readiness score, rule IDs, cryptographic finding fingerprints) is optionally synchronized.

### Q2: What encryption standards are used for data in transit and at rest?
- **In Transit**: All HTTP/API communications use TLS 1.3 (minimum TLS 1.2). GitHub webhooks use HMAC-SHA256 signatures.
- **At Rest**: PostgreSQL database storage is encrypted at rest using AES-256. Cryptographic release bundles are signed using Ed25519 asymmetric keys.

### Q3: How is tenant isolation enforced in multi-tenant environments?
Tenant isolation is enforced through three strict layers:
1. **Foreign-Key Scoping**: Every database query scopes access by `installation_id` and `tenant_id`.
2. **PostgreSQL Row-Level Security (RLS)**: Enforces tenant data separation at the database engine level.
3. **Artifact Path Containment**: Storage keys are strictly validated and scoped to prevent directory traversal (`..`).

---

## 3. Vulnerability Management & Incident Response

### Q4: How are software dependencies managed and audited for vulnerabilities?
- **Automated Scanning**: Nightly and per-commit automated dependency vulnerability audits via `pnpm audit` and Dependabot / Renovate.
- **SAST & Linting**: Automated static analysis using Semgrep, Biome, and SonarQube.
- **Supply Chain Security**: All release packages are signed, and production builds use pinned lockfiles (`pnpm-lock.yaml`).

### Q5: How do external researchers report security vulnerabilities?
Vulnerabilities are reported via GitHub Security Advisories or by emailing `security@boardreadyops.com` in accordance with [`SECURITY.md`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/SECURITY.md). Reports receive an initial response within 48 hours.

---

## 4. Compliance & Access Control

### Q6: What certifications are held by BoardReadyOps?
- **Current State**: SOC 2 and ISO 27001 certifications are currently `planned` / `in progress`.
- **Infrastructure**: Underlying cloud infrastructure providers (Vercel, AWS, Neon/Supabase) maintain SOC 2 Type II, ISO 27001, and GDPR compliance.
