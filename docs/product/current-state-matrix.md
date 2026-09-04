# BoardReadyOps Current-State Surface Matrix

*Date: September 2026*
*Product Positioning: The trust layer between KiCad commits and manufacturing release.*

---

## 1. Classification Definitions

| Classification | Meaning | Evidence Standard |
| :--- | :--- | :--- |
| `available` | Shipped, functional, tested, and documented. | Active source implementation + automated unit/integration test + docs reference. |
| `experimental` | Implemented and testable, but wire contract or public API may evolve. | Code and unit tests exist, but flagged as experimental or internal. |
| `planned` | Documented architectural target or schema definition; implementation intentionally not yet built. | Schema or ADR exists; no unverified code claim. |
| `unsupported` | Explicitly rejected or scoped out of the current platform architecture. | Documented architectural constraint / ADR rationale. |
| `external validation required` | Functional capability ready for pilot validation, pending real customer validation. | Code/tests ready; requires customer deployment data. |

---

## 2. CLI Command Surface

*Binary Entry Point*: [`src/cli/index.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/index.ts), [`src/cli/commands.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands.ts)

| Command | Status | Purpose | Implementation Source | Test Coverage |
| :--- | :--- | :--- | :--- | :--- |
| `boardreadyops run [path]` | `available` | Full pipeline execution (discover, validate, summarize, report). | [`src/cli/commands/run.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/run.ts) | [`tests/unit/cli/commands.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/commands.test.ts) |
| `boardreadyops check [rule-or-path] [path]` | `available` | Targeted rule or directory inspection. | [`src/cli/commands/check.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/check.ts) | [`tests/unit/cli/check.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/check.test.ts) |
| `boardreadyops plan [path]` | `available` | Emits agent-ready JSON remediation plan. | [`src/cli/commands/plan.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/plan.ts) | [`tests/unit/cli/plan.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/plan.test.ts) |
| `boardreadyops fix [path]` | `available` | Applies automated fixes for supported rule findings. | [`src/cli/commands/fix.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/fix.ts) | [`tests/unit/cli/fix.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/fix.test.ts) |
| `boardreadyops doctor` | `available` | Validates environment prerequisites and KiCad toolchains. | [`src/cli/commands/doctor.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/doctor.ts) | [`tests/unit/cli/doctor.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/doctor.test.ts) |
| `boardreadyops explain <rule-id>` | `available` | Detailed rule rationale, remediation, and KiCad versions. | [`src/cli/commands/explain.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/explain.ts) | [`tests/unit/cli/explain.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/explain.test.ts) |
| `boardreadyops schema [name]` | `available` | Outputs JSON schema definitions to stdout. | [`src/cli/commands/schema.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/schema.ts) | [`tests/unit/cli/schema.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/schema.test.ts) |
| `boardreadyops init` | `available` | Interactive and profile-based configuration bootstrap. | [`src/cli/commands/init.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/init.ts) | [`tests/unit/cli/init.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/init.test.ts) |
| `boardreadyops policy [path]` | `available` | Release policy evaluator and simulation mode (`--simulate`). | [`src/cli/commands/policy.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/policy.ts) | [`tests/unit/cli/policy.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/policy.test.ts) |
| `boardreadyops generate [path]` | `available` | Generates Gerbers, drill, BOM, CPL, PDF, STEP via `kicad-cli`. | [`src/cli/commands/generate.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/generate.ts) | [`tests/unit/cli/generate.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/generate.test.ts) |
| `boardreadyops sbom [path]` | `available` | Generates CycloneDX Hardware SBOM (HBOM). | [`src/cli/commands/sbom.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/sbom.ts) | [`tests/unit/cli/sbom.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/sbom.test.ts) |
| `boardreadyops vendor list/explain` | `available` | Lists and inspects manufacturing vendor profiles. | [`src/cli/commands/vendor.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/vendor.ts) | [`tests/unit/cli/vendor.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/vendor.test.ts) |
| `boardreadyops release pack` | `available` | Creates structured evidence bundle v2 directory with checksums. | [`src/cli/commands/release.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/release.ts) | [`tests/unit/cli/release.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/release.test.ts) |
| `boardreadyops release prepare` | `available` | One-command release pipeline (generate, validate, package). | [`src/cli/commands/release.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/release.ts) | [`tests/unit/cli/release.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/release.test.ts) |
| `boardreadyops release diff` | `available` | Release-to-release BOM and CPL diff comparison. | [`src/cli/commands/release.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/release.ts) | [`tests/unit/cli/release-diff.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/release-diff.test.ts) |
| `boardreadyops release sign/verify` | `available` | Ed25519 cryptographic signing and verification of bundles. | [`src/cli/commands/release.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/release.ts) | [`tests/unit/cli/release-signing.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/release-signing.test.ts) |
| `boardreadyops handoff create` | `available` | Vendor-specific manufacturer handoff zip creation. | [`src/cli/commands/release.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/release.ts) | [`tests/unit/cli/handoff.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/handoff.test.ts) |
| `boardreadyops baseline *` | `available` | Baseline capture, diff, show, clear, and prune. | [`src/cli/commands/baseline.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/baseline.ts) | [`tests/unit/core/baseline.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/core/baseline.test.ts) |
| `boardreadyops review publish/verify`| `available` | Publishes review pack to cloud and verifies evidence ledger. | [`src/cli/commands/review.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/review.ts) | [`tests/unit/cli/review.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/review.test.ts) |
| `boardreadyops runner *` | `available` | Self-hosted runner lifecycle (enroll, activate, once, serve). | [`src/cli/commands/runner.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/runner.ts) | [`tests/unit/cli/runner.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/cli/runner.test.ts) |

---

## 3. GitHub Action Surface

*Manifest*: [`action.yml`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/action.yml)
*Runtime Entry Point*: [`src/action/index.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/action/index.ts)
*Bundle*: `dist/action/index.cjs`

### Action Inputs
- `path`, `project`, `config`, `mode`, `release-mode`, `safe-mode`, `require-kicad`, `kicad-cli`, `bom`, `pinmap`, `variant`, `gate`, `sarif`, `json`, `markdown`, `hbom`, `upload-sarif`, `upload-artifacts`, `comment-pr`, `comment-format`, `artifact-name`, `fail-on`, `annotations`, `log-level`, `log-format`, `log-file`, `log-file-max-bytes`, `log-file-retention`, `cloud-upload`, `cloud-server`.

### Action Outputs
- `findings`, `critical`, `high`, `medium`, `low`, `sarif-path`, `json-path`, `markdown-path`, `hbom-path`, `review-url`, `cloud-run-id`, `evidence-pack-id`.

*Testing*: [`tests/unit/action/index.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/action/index.test.ts), [`tests/unit/action/hardware-impact.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/action/hardware-impact.test.ts).

---

## 4. Report Formats Surface

| Format | Status | Emitter Module | Schema / Contract | Test Coverage |
| :--- | :--- | :--- | :--- | :--- |
| **JSON Findings** | `available` | [`src/report/json.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/json.ts) | [`schemas/findings.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/findings.schema.json) | [`tests/unit/report/json.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/json.test.ts) |
| **SARIF v2.1.0** | `available` | [`src/report/sarif.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/sarif.ts) | OASIS SARIF 2.1.0 | [`tests/unit/report/sarif.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/sarif.test.ts) |
| **Markdown Report** | `available` | [`src/report/markdown.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/markdown.ts) | Mustache summary/detail | [`tests/unit/report/markdown.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/markdown.test.ts) |
| **PR Sticky Review Comment** | `available` | [`src/report/review-comment.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/review-comment.ts) | Compact release/impact review | [`tests/unit/report/review-comment.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/review-comment.test.ts) |
| **HTML Release Dashboard** | `available` | [`src/report/html.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/html.ts) | Standalone responsive HTML | [`tests/unit/report/html.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/html.test.ts) |
| **JUnit XML** | `available` | [`src/report/junit.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/junit.ts) | Standard JUnit testsuite format | [`tests/unit/report/junit.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/junit.test.ts) |
| **CycloneDX Hardware SBOM (HBOM)** | `available` | [`src/report/hbom.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/report/hbom.ts) | [`schemas/hbom.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/hbom.schema.json) | [`tests/unit/report/hbom.test.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/tests/unit/report/hbom.test.ts) |

---

## 5. Configuration & Evidence Schemas

| Schema | File Path | Validation Tooling |
| :--- | :--- | :--- |
| Config Schema | [`schemas/config.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/config.schema.json) | [`src/core/config.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/core/config.ts) |
| Findings Schema | [`schemas/findings.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/findings.schema.json) | [`src/core/findings.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/core/findings.ts) |
| Evidence Bundle Schema | [`schemas/evidence.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/evidence.schema.json) | [`src/release/evidence.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/release/evidence.ts) |
| Release Manifest Schema | [`schemas/release-manifest.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/release-manifest.schema.json) | [`src/release/manifest.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/release/manifest.ts) |
| Generate Recipe Schema | [`schemas/generate-recipe.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/generate-recipe.schema.json) | [`src/generate/recipe.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/generate/recipe.ts) |
| Pinmap Schema | [`schemas/pinmap.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/pinmap.schema.json) | [`src/pinmap/loader.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/pinmap/loader.ts) |
| Doctor Diagnostics Schema | [`schemas/doctor.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/doctor.schema.json) | [`src/cli/commands/doctor.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/doctor.ts) |
| Agent Plan Schema | [`schemas/agent-plan.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/agent-plan.schema.json) | [`src/cli/commands/plan.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/plan.ts) |
| Rule Pack Schema | [`schemas/rule-pack.schema.json`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/schemas/rule-pack.schema.json) | [`packages/plugin-sdk/src/index.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/plugin-sdk/src/index.ts) |

---

## 6. Cloud & Control Plane API Routes

*Base Directory*: [`apps/web/app/api/`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api)

| Route Path | Method | Status | Purpose & Contract | Source Reference |
| :--- | :--- | :--- | :--- | :--- |
| `/api/auth/github/login` | GET | `available` | Initiates GitHub OAuth flow. | [`apps/web/app/api/auth/github/login/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/auth/github/login/route.ts) |
| `/api/auth/github/callback` | GET | `available` | Handles OAuth token exchange. | [`apps/web/app/api/auth/github/callback/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/auth/github/callback/route.ts) |
| `/api/auth/logout` | POST | `available` | Clears viewer session cookie. | [`apps/web/app/api/auth/logout/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/auth/logout/route.ts) |
| `/api/github/webhook` | POST | `available` | Ingests GitHub App webhooks with HMAC. | [`apps/web/app/api/github/webhook/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/github/webhook/route.ts) |
| `/api/github/marketplace/webhook` | POST | `available` | Handles Marketplace lifecycle events. | [`apps/web/app/api/github/marketplace/webhook/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/github/marketplace/webhook/route.ts) |
| `/api/health`, `/live`, `/ready` | GET | `available` | Kubernetes/Docker health and readiness probes. | [`apps/web/app/api/health/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/health/route.ts) |
| `/api/v1/billing/webhook` | POST | `available` | Stripe webhook signature verification and event idempotency. | [`apps/web/app/api/v1/billing/webhook/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/billing/webhook/route.ts) |
| `/api/v1/billing/checkout` | POST | `available` | Creates a real Stripe Checkout session when `BILLING_MODE=stripe`/`both`; returns 410 `marketplace_free_only` by default. | [`apps/web/app/api/v1/billing/checkout/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/billing/checkout/route.ts) |
| `/api/v1/billing/portal` | POST | `available` | Creates a real Stripe Billing Portal session when `BILLING_MODE=stripe`/`both`; returns 410 `marketplace_free_only` by default. | [`apps/web/app/api/v1/billing/portal/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/billing/portal/route.ts) |
| `/api/v1/runs` | GET | `available` | Cursor-paginated, session-auth tenant run listing. | [`apps/web/app/api/v1/runs/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/runs/route.ts) |
| `/api/v1/runs/result` | POST | `available` | Ingests CLI/Action release run results. | [`apps/web/app/api/v1/runs/result/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/runs/result/route.ts) |
| `/api/v1/runs/github-actions-result` | POST | `available` | Ingests GitHub Actions run with OIDC verification. | [`apps/web/app/api/v1/runs/github-actions-result/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/runs/github-actions-result/route.ts) |
| `/api/v1/runner/*` | POST | `available` | Self-hosted runner protocol (jobs, leases, results). | [`apps/web/app/api/v1/runner/jobs/claim/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/runner/jobs/claim/route.ts) |
| `/api/v1/data-exports` | GET/POST | `available` | Tenant-scoped data export requests. | [`apps/web/app/api/v1/data-exports/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/data-exports/route.ts) |
| `/api/v1/erasure-requests` | POST | `available` | GDPR/tenant erasure intake with legal hold check. | [`apps/web/app/api/v1/erasure-requests/route.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/apps/web/app/api/v1/erasure-requests/route.ts) |

---

## 7. Plugin SDK Extension Points

*Package*: [`packages/plugin-sdk/src/index.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/plugin-sdk/src/index.ts)
*Loader*: [`src/core/plugin-loader.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/core/plugin-loader.ts)

| Extension Point | Status | Host Dispatch State | Rationale / Implementation |
| :--- | :--- | :--- | :--- |
| `rules` | `available` | **Fully Dispatched** | Registered into core `RuleRegistry` and executed in pipeline. |
| `permissions` | `available` | **Enforced** | Manifest static pre-check + permission evaluation against config. |
| `rulePacks` | `available` | **Schema Validated** | Type-checked & validated in manifest; override engine active. |
| `adapters` | `planned` | *Type definition only* | Reserved extension point for future custom EDA formats. |
| `reportFormats` | `planned` | *Type definition only* | Reserved extension point for custom report emitters. |
| `vendorProfiles` | `planned` | *Type definition only* | Reserved extension point for custom fabricator rules. |
| `notifiers` | `planned` | *Type definition only* | Reserved extension point for custom webhook dispatchers. |
| `supplierProviders` | `experimental`| *Type definition only* | Experimental hook for live supplier API integrations. |

---

## 8. Tier & Governance Matrix (Free / Team / Business)

*Source of Truth*: [`packages/cloud-core/src/entitlements.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/cloud-core/src/entitlements.ts), [`packages/contracts/src/billing.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/contracts/src/billing.ts)

| Capability / Resource | Community (Free) | Team | Business | Enterprise (Custom Contract) | Enforced In Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CLI & Action Core Rules** | Unlimited | Unlimited | Unlimited | Unlimited | Yes ([`src/core/pipeline.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/core/pipeline.ts)) |
| **Active Watched Boards** | 1 board | 10 boards | 100 boards | Custom | Yes ([`packages/cloud-core/src/entitlements.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/cloud-core/src/entitlements.ts)) |
| **Evidence Retention** | 30 days | 365 days | Unlimited | Unlimited | Yes ([`packages/db/src/retention-maintenance-store.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/db/src/retention-maintenance-store.ts)) |
| **Scheduled Supply Watch** | Disabled | Enabled | Enabled | Enabled | Yes ([`packages/cloud-core/src/entitlements.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/cloud-core/src/entitlements.ts)) |
| **Permissioned Handoff Links** | Disabled | Enabled | Enabled | Enabled | Yes ([`packages/cloud-core/src/entitlements.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/cloud-core/src/entitlements.ts)) |
| **Release Policy Simulation** | Available | Available | Available | Available | Yes ([`src/cli/commands/policy.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/cli/commands/policy.ts)) |
| **Expired Waiver Blocking** | Available | Available | Available | Available | Yes ([`src/core/readiness.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/src/core/readiness.ts)) |
| **SIEM Event Stream** | `unsupported` | `unsupported` | `experimental` (in-memory) | `planned` (webhook) | Yes ([`packages/cloud-core/src/enterprise/siem-stream.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/cloud-core/src/enterprise/siem-stream.ts)) |
| **SAML / SCIM / SSO** | `unsupported` | `unsupported` | `planned` | `planned` | Architectural Design ([ADR 0015](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/docs/architecture/adr/0015-enterprise-governance-sso-scim.md)) |

---

## 9. Marketplace & Commercial Guardrails

- **Marketplace Free-Only Guard**: The GitHub Marketplace listing operates exclusively on the Community Free tier. External billing endpoints (`/api/v1/billing/checkout` and `/api/v1/billing/portal`) default to HTTP 410 (`marketplace_free_only`) — controlled by the `BILLING_MODE` environment variable (`apps/web/lib/billing-mode.ts`), which defaults to `marketplace_free` — so paid billing cannot be accidentally activated in production without an operator deliberately setting `BILLING_MODE=stripe` or `both` and configuring `STRIPE_SECRET_KEY`.
- **Listing Verification Script**: [`scripts/check-marketplace-listing.mjs`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/scripts/check-marketplace-listing.mjs) validates that metadata, branding, and marketplace badges remain strictly in sync with GitHub standards.
