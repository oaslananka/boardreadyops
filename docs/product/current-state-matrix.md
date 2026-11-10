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
| `/api/v1/data-exports` | POST | `available` | Records an export request only for an explicitly authorized installation (`installationId` required); no archive is generated automatically. | [`apps/web/app/api/v1/data-exports/route.ts`](../../apps/web/app/api/v1/data-exports/route.ts) |
| `/api/v1/data-exports/:exportId` | GET | `available` | Returns export request metadata (not a downloadable file); the required `installationId` query must select an installation authorized for the current session. | [`apps/web/app/api/v1/data-exports/[exportId]/route.ts`](../../apps/web/app/api/v1/data-exports/[exportId]/route.ts) |
| `/api/v1/data-exports/:exportId?download=archive` | GET | `partial` | Disabled unless `BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT` provisions a separate, private 0700 shared directory. Original-requester/installation/repo authorization and ZIP bytes are checked before streaming. Worker can prepare one installation's ZIP into a reserved private directory on the existing artifact volume, strictly opt-in with a separate installation setting; an internal legal-hold-fenced explicit cleanup path exists but is not scheduled. Local Next.js standalone + signed-session/PostgreSQL 17 acceptance confirms ZIP digest, original requester authorization, tamper rejection, revocation and actual early client disconnect with audit rollback; no deployed customer transfer, production enablement or post-uninstall recovery yet. | [`apps/web/app/api/v1/data-exports/[exportId]/route.ts`](../../apps/web/app/api/v1/data-exports/[exportId]/route.ts) |
| `/api/v1/data-exports/:exportId` | DELETE | `partial` | Same-origin authenticated original requester may revoke the short-lived metadata preview (default), or the separately staged internal ZIP commitment (`?revoke=archive`), without publishing a ZIP, deleting data, or completing the export. | [`apps/web/app/api/v1/data-exports/[exportId]/route.ts`](../../apps/web/app/api/v1/data-exports/[exportId]/route.ts) |
| `/api/v1/historical-user-exports/:exportId` | GET | `partial` | Server-verified signed GitHub OAuth numeric identity returns bounded metadata-only post-uninstall user export status without a live installation; legacy login-only exports and completed erasures are denied; never returns ZIP bytes, signed URL or erasure authority. Source-only, not deployed. | `apps/web/app/api/v1/historical-user-exports/[exportId]/route.ts` |

| `/api/v1/erasure-requests` | POST | `available` | Records a legal-hold-aware erasure request for an authorized `installationId`; submission does not delete records. | [`apps/web/app/api/v1/erasure-requests/route.ts`](../../apps/web/app/api/v1/erasure-requests/route.ts) |

Internal source-only preflight: retained historical-USER local artifact bytes can be verified against stored SHA-256/size with original-owner reauthorization and a durable shared-path unlink fence. This is **not** an HTTP endpoint, ZIP publication, customer delivery, or enabled worker. A bounded **partial** ZIP preflight now checks that every original-user snapshot artifact has exactly one previously verified local object; its consistent core snapshot also includes bounded owner-scoped review comments, approval reasons, checklist titles, finding decision reasons, and finding assignment descriptors, but excludes individual decision owners, approvers, assignees, assigners, actor identities and arbitrary audit metadata. The consistent core additionally records only eight bounded counts of suppressed installation/repository audit actor, subject, request-ID and metadata values; unknown actor types are redacted, and the independent ZIP verifier rejects injected identity or metadata fields and foreign audit links. The core now also inventories *counts only* for five original numeric-user-bound excluded classes: proprietary run snapshot visuals, API token records, runner registrations, encrypted installation provider credentials and licensed per-installation component observations (hard cap 100 each, fail-closed on overflow). Login-only policy/billing audit records remain unverifiable and excluded; private content, token hashes and credentials are never copied. A separate source-only original numeric-USER private-visual preflight checks bounded stored SVG UTF-8 content against its SHA-256 and emits only ID/run/repository/digest/byte-count descriptors, never design SVG, sheet labels, anchors or URLs. The source-only partial ZIP v3 now includes a separate **content-free private visual evidence metadata entry** and an integrity receipt that cryptographically binds it, original-user core metadata and physical artifacts in one deterministic in-memory ZIP. Private visual hashes/counts are compared before and after file IO, and the checked-write gate can re-evaluate both core and visual evidence. Each core+visual pair now uses ONE original numeric-USER-scoped PostgreSQL REPEATABLE READ READ ONLY snapshot, so concurrent edits cannot split its core counts from the visual proof. The initial and final pairs, physical file IO and per-write transport checks still span DIFFERENT transactions. Source-only migration 0118 tracks original USER review rows, private visual snapshots and append-only audit INSERTs. Additive migration 0119 extends the same committed mutation revision to review revisions, comments, approvals, checklist items, finding decisions and assignments via actual review/repository ownership. The scoped fingerprint is bound to partial ZIP v3; edit-restore ABA for tracked classes is rejected even if content hashes return to previous values, and a different numeric GitHub user sharing the login cannot change the original user's fingerprint. Other data classes still lack mutation epochs: there is no complete durable immutable snapshot or customer delivery grant, SVG rendering safety is not established, and design IP is never disclosed. The original USER internal partial core now additionally suppresses
repository owner/name, run ref, finding path, artifact name, review title
and review-comment visual anchor; independent ZIP receipt validation
rejects any reinsertion after hash recomputation. Source DB values remain
untouched. The archive still contains separately verified raw artifact
bytes and remaining opaque IDs, commit/finding hashes and other descriptors;
the count-only diagnostic explicitly blocks unverified physical artifact
disclosure rights and must never be treated as customer-ready.
The separate original USER physical-byte partial ZIP v3 PRIVATE
stage/inspect boundary now rechecks the full original-owner artifact
manifest and canonical hold/erasure/deletion/retention and mutation
epoch gate, rather than trusting unchanged ZIP/source digests alone.
A queue-only deletion makes staged private state stale without altering
core SHA. No customer route/entitlement or public delivery added.
Original numeric GitHub USER source inventory and physical artifact
locator reads now fail closed BEFORE returning source metadata or
private storage paths if the export is expired, any tenant legal hold
is active, or a real running/completed erasure exists. Dry-run erasure
remains nonblocking; legitimate non-destructive uninstall export
request intake is unaffected. Locked final-transfer admission and
customer ownership/disclosure rights are separate, still-required
steps. Verified with PostgreSQL deny/recover tests.

A separate internal live GitHub OAuth step-up helper now validates
one-time GitHub authorization-code exchange and live /user numeric
identity against a recent signed server session and export-bound
callback CSRF state. Isolated PostgreSQL acceptance uses a distinct
suspended GitHub USER tenant to respect the one-active-export and
immutable one-preflight constraints. Tests verify successful PRIVATE
stage, foreign numeric USER and wrong state rejection, irreversible
revocation and no customer delivery. A default-OFF, source-only
historical OAuth start route now reuses the existing registered callback.
The original numeric USER, exact pending export, <=5-minute signed
session, HMAC-bound state/export/user/issuance-time challenge and fresh
GitHub /user must match. Wrong/expired/challenge-substituted state is
rejected before GitHub, and two __Host- HttpOnly/Secure state cookies
are cleared on callback. Success redirects only to dashboard status,
without replacing the ordinary login session, staging a ZIP, or minting
customer entitlement. New source-only migration 0122 now stores only
the SHA-256 nonce digest with original numeric USER/export identity,
immutable five-minute expiry and one-way consumed timestamp. It
requires a pending original USER export, blocks active tenant holds/
non-dry-run erasure, and atomically consumes the nonce BEFORE GitHub
authentication. OAuth nonce issue/consume now share the existing
original USER private preflight short-lived legal-hold table and owner
row locks, and the nonblocking tenant advisory lock used by real
erasure writers. PostgreSQL tests prove exactly one of 12 concurrent
callbacks wins and that uncommitted hold/erasure writer races fail
closed without provider access. Replay or provider failure cannot
restore nonce authority. Neither the migration nor feature is
deployed; there is
no real GitHub browser acceptance, full archive release, or customer
download entitlement. A SOURCE-ONLY private partial-ZIP v3 seal path now fsyncs the
verified physical archive to owner-private 0700/0600 storage, uses
atomic no-clobber linking, reopens with no-follow integrity validation,
then rechecks full original numeric USER source and physical object
preflight. Real isolated PostgreSQL/local-file tests reject changed
artifact bytes, wrong owner, symlinked/group-readable roots and
corrupted destinations. This is NOT a complete externally signed
archive, DB+filesystem atomic commitment or active cleanup policy;
private orphans without an exact immutable DB binding remain
quarantined. A SOURCE-ONLY migration 0124 and MANUAL-ONLY helper now
permit audited deletion of matching verified private partial ZIP files
only for failed original numeric USER exports aged over one hour and
revoked/expired private preflights. Current hold/erasure/reader reservations,
wrong owner, tampered ZIP or unsafe filesystem state deny. An immutable
per-export deleted/missing audit is recorded; no orphan scanning, scheduled cleanup, customer route or complete DB+FS
transaction is introduced. A separate source-only migration 0125 now
provides an explicit durable original numeric USER/private preflight
reservation for the NEW internal ZIP verifier. The reservation is
committed before private disk IO and released once after DB/ZIP check;
cleanup denies unresolved readers, confirmed by separate PostgreSQL
connection tests. Crashed readers are NOT timer-reaped and the
low-level disk reader and future HTTP delivery streams do not inherit
this coordination automatically. Automatic janitor/customer ZIP NO_GO.

Historical customer export remains NO_GO.

The source-only metadata-only ZIP builder now also uses the canonical
original USER PostgreSQL prepublication gate after enumerating all
retained artifact database locators without filesystem IO. It denies
active legal holds, revoked exports, running erasure, imminent artifact
retention, stale/changed artifact manifests, or core/visual/epoch drift,
instead of relying solely on two snapshot reads. This is a short
internal database admission, NOT a persisted customer delivery claim,
lifetime snapshot lock or permission to publish bytes.

A separate **private count-only metadata exposure diagnostic** now
classifies remaining opaque GitHub repository IDs, run/revision commit
hashes, artifact SHA-256/size, finding fingerprint/evidence digests and
private visual digest descriptors. The result contains fixed category
names, row counts and explicit `NO_GO` blockers only; it does not disclose
source values or attest original-user identity/third-party rights. Its
input is an independently verified local metadata-only ZIP, never the
physical-byte partial v3 archive. Not a customer route or export approval.
A SEPARATE internal original numeric USER metadata-only ZIP variant now
stores exactly three verified metadata entries (redacted historical core,
content-free visual evidence, v1 metadata-only integrity receipt), with
zero objects/ paths or physical artifact file bytes. Even with a retained
artifact descriptor present, no storageRoot/physical file read is required;
its independent verifier rejects extra byte-backed entries and fully
rehashed identity/receipt forgeries, and cannot confuse this type with
the existing physical-byte partial ZIP v3. No customer authorization,
signed grant, complete export or public download route was added. The
DB-only original-owner admission checks current core/visual/epoch twice
but is NOT an atomic delivery lease. Source-only; not deployed.

Source-only private original USER partial ZIP v3 now strips six free-text
surfaces (finding message, review comment content, review approval reason and
invalidation reason, review checklist title and finding decision reason)
to empty/null with false inclusion flags. Source database rows stay intact;
independent ZIP verification and exclusions deny re-introduced text even with
fully recomputed hashes. Diagnostic text counts reflect only exported
included text and do NOT prove no original third-party content; private
artifact bytes, titles/paths and legal rights remain separate blockers.
The internal private ZIP v3 disclosure-readiness diagnostic now outputs
only 13 source-class counts, six non-empty human-text field counts, excluded
sensitive-source/audit redaction counts and explicit blocker codes; it never
copies comments, design content, actor identities or repository names into
the result. Even zero rows and zero exclusions mean
`customerDeliveryReady=false` and `completeCustomerExport=false`:
third-party text rights, private SVG/design rights, original-owner
provenance and a genuine revocable sealed customer delivery remain unresolved.
Format v2 explicitly adds six third-party text-source acceptance decisions
with all ownership/rights evidence unverified and eight independent legal,
provenance, completeness and transfer-safety gates; every decision remains
NO_GO, even on empty archives. The diagnostic is a local, content-free
assessment and does not replace the separate original numeric-USER live DB
authorization preflight.
The source-only web entrypoint now binds 0121's candidate fingerprint to
the ACTUAL private ZIP v3 bytes: SHA-256 is computed from those bytes,
the independent ZIP/receipt/object verifier runs first, and core/visual/ABA
fingerprints extracted from the verified payload are checked against the
original numeric GitHub USER's current coherent PostgreSQL snapshot.
Tampered compressed data and a fully rehashed ZIP with forged owner mutation
epoch are denied. The independent ZIP verifier additionally enforces the
historical core's full top-level and per-row field allowlists, its exact
exclusion-label policy, and fixed privacy/disclosure flags for review actors,
approvers, checklist completion and artifacts. Unknown identity/credential
fields remain rejected even if their JSON, receipt and full ZIP hashes are
recomputed; this does not certify private source rights or full customer
export completeness. This web preflight remains internal, does not persist/stream
archive bytes or authorize a public customer download. The uncommitted
additive 0121 private candidate preflight additionally records the original numeric USER, immutable prospective ZIP/core/visual/epoch hashes, at most 10-minute expiry and one-way revocation with staged/revoked audit events; it checks original-user scoped current metadata, legal holds and real erasure status and forbids customer_delivery_allowed or complete_customer_export at the SQL CHECK level. It is NOT a verified complete ZIP, a bearer/download token, actual customer delivery authorization, in-flight network revocation, or deployed capability. The archive acquires all durable physical-copy reservations in a single all-or-nothing PostgreSQL transaction before file IO, keeps every path fenced until the entire ZIP assembly settles, and has a per-file SHA-256 receipt, independent full ZIP integrity check and final core snapshot equality check. A separate source-only prepublication check now revalidates the original numeric user, complete physical manifest, request status, retention, deletion jobs, running erasure and active holds under short PostgreSQL row/hold-table locks. An active legal hold requires manual review; concurrent writers fail closed. The gate also has a source-only awaited-transfer test hook: it keeps export and legal-hold writer locks until a bounded write settles. PG17 and localhost Node HTTP tests prove a revoked original-user request denies the *next* transport chunk, while a failed sink rolls back. Source-only migration 0117 now also fences same-tenant erasure changes, artifact additions, physical deletion-job admissions and append-only audit INSERT/review INSERTs during a checked transfer chunk. Review reparenting locks the original and new tenant keys in deterministic order; unrelated tenant audit writes remain available. A competing retention row lock fails the gate busy without deadlock. No historical customer HTTP route, complete archive or durable transfer lease is created; already-sent chunks cannot be retracted. The source-only gate can now compare the expected private partial-core SHA-256 and byte count against a fresh original numeric-USER repeatable-read core before and after each bounded write: it rejects audit/review edits between chunks, or reports stale when review content mutates in-flight. This optional comparison is neither an atomic hold/metadata lock nor a durable delivery claim; previously written bytes cannot be recalled and untracked data-class edit-and-restore races remain possible. These transaction locks do not persist any customer publication rights or download authorization. Its completeCustomerExport=false marker is mandatory; it is not a publish permission or downloadable customer archive.

---

The uninstall/export recovery status is still **partial**: migration 0115 records
immutable GitHub user IDs for new signed-webhook user uninstall export requests.
A dedicated session-authenticated metadata-only historical status endpoint is now in
source, backed by the original immutable numeric GitHub account ID. Legacy
username-only requests and actual historical ZIP archive delivery remain
unavailable; this route is not deployed and never revives an uninstalled App.
An internal bounded SHA-256 repository-metadata preflight now verifies retained
suspended user installations by original numeric ID and tenant, but deliberately
is separate from another bounded, SHA-256 run/finding historical
preflight. A new internal combined repository/run/finding/artifact-metadata
preflight uses one immutable-owner gate and one bounded repeatable-read
PostgreSQL snapshot. It includes repository/run/finding facts, declared
artifact digest/size/retention metadata, review/revision descriptions,
bounded review comment/approval/checklist **descriptors**, repository-scoped
and original suspended-installation audit event descriptions. Installation-
only events have no actor/subject IDs or payloads. The original
user/review/repository relationships
and comment parent chains are checked, including per-class overflow rejection.
It never includes artifact contents/storage paths, comment bodies/authors,
approval actors/reasons, checklist titles or audit metadata/actors.
Installation-only audit, full tenant data, ZIP staging, transfer and customer
recovery remain unavailable.

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
