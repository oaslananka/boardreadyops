# BoardReadyOps Privacy Policy

Last updated: August 28, 2026

This Privacy Policy describes how BoardReadyOps ("we", "us", or "our") collects, uses, retains, and protects information when you use the BoardReadyOps open-source CLI, GitHub Action, and the hosted BoardReadyOps Cloud service at `boardreadyops.com`.

---

## 1. Scope & Product Architecture

BoardReadyOps provides hardware release-readiness verification and CI automation for KiCad design projects.

- **Local CLI and GitHub Action (Open Source)**: When running the CLI or Action in your own environment (e.g. your local workstation or your own GitHub Actions runners), design files and KiCad project data are processed locally within your environment. No source code or design files are transmitted to BoardReadyOps servers unless you explicitly configure the cloud integration.
- **Hosted Cloud Control Plane (`boardreadyops.com`)**: When you install the BoardReadyOps GitHub App or connect your repositories to the hosted service, the service receives and processes webhook events, normalized release results, and optional report artifacts as described below.

---

## 2. Information We Collect and Process

When using the hosted BoardReadyOps Cloud service, we process the following categories of data:

### A. GitHub Account and Installation Metadata
- GitHub installation identifier, account login, account type (User or Organization).
- Repository metadata: repository ID, repository name, full name, owner, visibility (public/private), and default branch.
- OAuth user identifiers when authenticating to the dashboard.

### B. Release Run and Finding Metadata
- Commit SHA, git ref, pull request number, workflow trigger kind.
- Normalized release results, readiness scores, and rule finding summaries (rule ID, severity, message, repository-relative file paths).
- Run timestamps, execution duration, and KiCad/BoardReadyOps version strings.

### C. Managed Artifacts and Reports
- When configured to store report artifacts, the control plane stores generated report objects (e.g. HTML/JSON readiness reports, manifest files, visual snapshots) and associated metadata (SHA-256 digest, byte count, artifact kind, content type).
- In the standard GitHub Actions execution mode, raw source code archives are **not** uploaded to or retained by the BoardReadyOps control plane.

### D. Webhook and Delivery Intake Data
- GitHub webhook delivery IDs (`X-GitHub-Delivery`), event types (`installation`, `pull_request`, `marketplace_purchase`, `ping`), payload SHA-256 digests, and delivery timestamps.
- Raw GitHub webhook payloads are validated in memory and are **not** inserted into long-term database storage.

### E. Marketplace and Billing Metadata
- GitHub Marketplace purchase events: account login, plan identifier, plan name, billing cycle, effective date, and free trial status.
- We do **not** collect or store credit card numbers or payment credentials; billing transactions on GitHub Marketplace are handled exclusively by GitHub.

### F. Append-Only Audit Logs
- Actor identity (e.g., GitHub login or runner identity), tenant ID, action performed, timestamp, and privacy-bounded metadata.

---

## 3. Information We Explicitly Do Not Store

To protect your hardware IP and security:
- **No Source Code Archives**: In default GitHub Actions mode, full repository source code remains entirely within your GitHub runner environment.
- **No Vendor/Supplier Credentials**: BoardReadyOps does not collect or require third-party manufacturing or component vendor credentials.
- **No Raw Token or Private Key Secrets**: Plaintext capability tokens, signing secrets, webhook secrets, and private keys are never stored or logged.

---

## 4. Data Retention and Lifecycle

In accordance with our implemented data lifecycle controls:

| Data Class | Stored Scope | Retention Policy |
| --- | --- | --- |
| **Webhook Intake Metadata** | Delivery ID, event type, digest, state | Terminal metadata is retained for 30 days by default before automated pruning. Raw payload is discarded after intake validation. |
| **Control Plane History** | Completed outbox effects, reconciliation items | Retained for 90 days by default before bounded automated cleanup. |
| **Ephemeral Capabilities & Nonces** | Single-use tokens, upload capabilities | Retained for 30 days by default after consumption or expiry. |
| **Release Runs & Findings** | Run records, findings, readiness score | Retained until associated repository or installation is removed or modified by lifecycle operations. |
| **Managed Report Artifacts** | Report files and digests | When replaced by newer accepted results, old artifact metadata is removed transactionally and local storage objects are deleted asynchronously. |
| **Audit Logs** | Security and administrative audit entries | Retained append-only for operational proof and compliance tracking. |

---

## 5. Third-Party Services and Subprocessors

The hosted BoardReadyOps service integrates with the following third parties:

1. **GitHub (GitHub, Inc.)**: OAuth authentication, GitHub App webhooks, GitHub Marketplace billing, and Check Runs / GitHub Actions status reporting.
2. **Cloudflare**: DNS and edge reverse proxy security protection.
3. **PostgreSQL / Hosting Infrastructure**: Secure self-hosted / dedicated cloud infrastructure for persistent state and blob storage.

---

## 6. Security and Compliance

We apply defense-in-depth controls including:
- HMAC-SHA256 constant-time webhook signature verification (`X-Hub-Signature-256`).
- Foreign-key enforced tenant isolation preventing cross-tenant data access.
- Role-based dashboard authorization and repository-scoped access tokens.
- Secret scanning (`gitleaks`), automated dependency scanning, CodeQL, and SBOM verification in CI.

*Transparency statement: BoardReadyOps does not currently hold formal SOC 2, ISO 27001, or FedRAMP certifications. We clearly state our security practices and limitations directly in our codebase and security policies.*

---

## 7. Current Limitations & Data Erasure

As documented in our repository architecture:
- Organization-wide automated self-service data erasure and bulk data export APIs are currently limited to repository uninstall lifecycle events and administrative operator workflows.
- Database backups and infrastructure-level logs are managed on independent retention schedules.

---

## 8. Your Rights and Contact Information

To request access to, correction of, or deletion of your account or repository data from BoardReadyOps Cloud, please:
- Open a request via GitHub Issues: [https://github.com/oaslananka/boardreadyops/issues](https://github.com/oaslananka/boardreadyops/issues)
- Or report security/privacy vulnerabilities privately via GitHub Security Advisories: [https://github.com/oaslananka/boardreadyops/security/advisories/new](https://github.com/oaslananka/boardreadyops/security/advisories/new)
