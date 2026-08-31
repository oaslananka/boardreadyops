# BoardReadyOps Professional Product Transformation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BoardReadyOps into a professional, local-first policy-as-code hardware review gate ("The trust layer between KiCad commits and manufacturing release") with airtight plugin security, reproducible toolchain, deterministic hardware change impact, robust data lifecycle & billing readiness, and comprehensive GTM artifacts.

**Architecture:** 
- Strict separation between local-first CLI/Action execution and self-hosted/cloud control plane.
- P0 Plugin Security: Static manifest validation and permission evaluation BEFORE any plugin code execution; safe mode default-deny.
- Exact-base deterministic hardware impact modeling (`HardwareImpactV1`).
- Bounded, privacy-safe data lifecycle with dry-run/purge maintenance and tenant isolation.
- Test-mode billing engine with webhook idempotency and state machine projection.

**Tech Stack:** TypeScript 6, Node.js 22/24, pnpm 11, Vitest 4, Commander 15, Zod 4, Next.js 15 / Hono, PostgreSQL / Prisma, Biome, MkDocs, Docker.

## Global Constraints
- Positioning: "The trust layer between KiCad commits and manufacturing release".
- Scope exclusion: Bus factor is strictly out of scope. No modifications or additions related to bus factor.
- Principle: Think before coding, surgical edits, verify with evidence, caveman response style.
- No fabricated customer/revenue claims: claims classified as `available`, `experimental`, `planned`, `unsupported`, or `external validation required`.
- Zero default outbound telemetry in CLI.

---

## Subprojects & Execution Tasks

### Task 0: Baseline Product Truth & Current-State Surface Matrix
- [x] Map all surfaces (CLI, Action, Report, Config, Cloud, Billing, Plugin SDK, Retention, Marketplace).
- [x] Classify each surface as `available`, `experimental`, `planned`, or `unsupported`.
- [x] Align outcome roadmap with key product outcomes (Activation, TTFUF, Finding Quality, Recurring Usage, Trusted PR Decisions, Paid Validation, Trust/Security).

### Task 1: Document Truth & Onboarding (Phase 1)
- [ ] Align `README.md`, `docs/index.md`, `docs/quickstart.md` on unified positioning.
- [ ] Detail four onboarding flows: Local First Check, GitHub PR Gate, Manufacturer Handoff, Private/Local-only.
- [ ] Document Golden Demo and install guides with checksums, updates, rollback, uninstall.
- [ ] Validate and document the supported report formats matrix.

### Task 2: Reproducible Developer Toolchain (Phase 2)
- [ ] Fix `scripts/verify-version.mjs` major release check (`major >= 2` guard for future major releases).
- [ ] Add `.devcontainer/devcontainer.json` for reproducible Node 24 + Python + KiCad environment.
- [ ] Verify `toolchain:bootstrap` and `toolchain:doctor` contracts across platforms.

### Task 3: Plugin Trust, Isolation & SDK Contract (Phase 3 - P0 Security)
- [ ] Refactor `src/core/plugin-loader.ts` to inspect/validate manifest BEFORE importing any code.
- [ ] Enforce permission checks and safe-mode rejection before execution.
- [ ] In safe mode or when unauthorized permissions are requested, reject untrusted plugin execution without loading into process.
- [ ] Mark SDK extension points as `stable`, `experimental`, `reserved`, or `unsupported`.
- [ ] Add comprehensive tests for malicious/untrusted plugins, unauthorized permissions, safe-mode denial, and duplicate rule IDs.

### Task 4: Architecture Boundaries & Public Contract (Phase 4)
- [ ] Document versioning, deprecation, and schema evolution policy.
- [ ] Implement/verify rule timeout, cancellation via `AbortSignal`, and structured telemetry.
- [ ] Verify monorepo package boundaries and schema-to-type alignment.

### Task 5: Hardware Change Impact v1 Verification (Phase 5)
- [ ] Verify exact-base SHA binding and deterministic facts vs. assessment model.
- [ ] Verify PR comment formatting, evidence references, and fallback for unavailable baselines.
- [ ] Ensure full test coverage and snapshot stability.

### Task 6: Cloud Data Lifecycle & Tenant Trust (Phase 6)
- [ ] Verify tenant isolation and cross-tenant protection in database stores.
- [ ] Enhance retention maintenance with dry-run/execute purge capabilities and audit event logging.
- [ ] Align `PRIVACY.md` and `TERMS.md` with true implementation capabilities.

### Task 7: Billing & Entitlement Readiness (Phase 7)
- [ ] Build test-mode Stripe checkout and customer portal routing with clear disabled flag in production.
- [ ] Implement robust webhook event idempotency and customer/subscription entitlement projection in `@boardreadyops/db` and `@boardreadyops/cloud-core`.
- [ ] Add integration tests for subscription lifecycle (trial, active, past_due, canceled, unpaid).

### Task 8: Premium Governance & Policy Surface (Phase 8)
- [ ] Document organization policies, repository overrides, policy packs, and waiver workflows.
- [ ] Verify expired waiver blocking and immutable audit logging.
- [ ] Clearly delineate Community ($0) vs. Team vs. Business capabilities.

### Task 9: Product Metrics & Privacy-Safe Measurement (Phase 9)
- [ ] Define North Star and privacy-safe telemetry event schemas (local diagnostics, zero default outbound network calls).
- [ ] Document external exit gates and measurement infrastructure.

### Task 10: Market, Pricing & GTM Artifacts (Phase 10)
- [ ] Create competitor matrix as of August 2026 (KiCad CLI, KiBot, AllSpice, Flux, Altium 365, Siemens Valor, GitHub SARIF).
- [ ] Detail ICP, JTBD, messaging, pricing hypotheses, and buyer journey.
- [ ] Produce production-ready templates (interview scripts, survey, LOI, pilot scorecard, objection handling, security FAQ).

### Task 11: Release, Quality & Security Verification (Phase 11)
- [ ] Run full test suite: unit, integration, action, property, snapshot, accessibility.
- [ ] Run typecheck, lint, structure verification, and dist bundle build/verification.
- [ ] Perform SonarQube local analysis and fix actionable findings.
