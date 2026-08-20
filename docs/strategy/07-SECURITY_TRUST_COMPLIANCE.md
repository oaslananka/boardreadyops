# Security, Trust, and Compliance Strategy

BoardReadyOps asks customers to trust release decisions that affect physical production. Security is therefore part of the product promise, not a back-office checklist.

## Trust pillars

### 1. Least privilege

- GitHub App permissions match actual deployed behavior.
- No unused permissions/events.
- No Contents write permission solely for zero-file onboarding.
- Separate production/development registrations where operationally justified.

### 2. Strong execution identity

- short-lived GitHub OIDC for hosted target-repository results;
- binding to installation/repository/workflow/event/branch/environment/run/attempt/SHA as required;
- fail-closed validation;
- replay and cross-tenant substitution tests.

### 3. Source/data boundary clarity

Default architecture keeps source checkout and KiCad execution in the target GitHub repository boundary. Product copy must explain what metadata/evidence enters BoardReadyOps Cloud and what remains in GitHub.

### 4. Evidence integrity

- cryptographic digests;
- signatures/attestations where supported;
- tool/policy/version identity;
- immutable or append-only audit semantics for trust-critical history where appropriate;
- offline verification of release evidence.

### 5. Operational resilience

GA requires evidence for:

- durable webhook/job processing;
- retry and reconciliation;
- backup/restore;
- RPO/RTO;
- load/soak behavior;
- failure injection;
- incident/runbook readiness.

Issue #191 makes control-plane reliability a prerequisite to GitHub Cloud GA.

## Security launch blockers

Treat as P0/GA blocking when they can cause:

- cross-tenant access;
- forged/misattributed result acceptance;
- source/secret exposure;
- privilege escalation;
- release evidence integrity failure;
- unrecoverable accepted work;
- misleading security/public claims.

## Plugin trust

Current in-process JavaScript plugins should be treated as trusted workspace code, not a sandbox. A public hosted marketplace must remain downstream of a real runtime security model including permissions, provenance, isolation/resource limits, network policy, review/revocation, and versioning.

Config-only rule packs are a safer ecosystem surface than arbitrary code.

## Compliance posture

BoardReadyOps can produce evidence useful to customer compliance programs. Avoid blanket claims such as “CRA compliant,” “SLSA compliant,” “ISO compliant,” or equivalent unless scope and evidence justify them.

Prefer wording such as:

- “generates evidence that can support…”;
- “provides traceability for…”;
- “exports…”;
- “helps enforce organization policy…”

## EU Cyber Resilience Act opportunity

For products with digital elements, CRA creates demand for traceability, vulnerability/product evidence, and operational processes. Treat this as product tailwind and evidence-pack opportunity, not a certification claim.

A future “CRA Evidence Pack” may aggregate only evidence BoardReadyOps actually has: product/release identity, hardware/software BOM references, provenance, policy decisions, vulnerability-related references, approvals, and change history.

## Standards strategy

Use standards as interoperability layers where they fit:

- CycloneDX HBOM/MBOM/SBOM concepts;
- signed manifests/attestations;
- provenance formats;
- machine-readable schemas.

Do not hard-code product architecture around an unreleased standard version. Use adapters/versioned exports.

## Trust center plan

If the commercial domain is adopted, reserve a future `trust.<domain>` surface for:

- architecture/data-flow overview;
- GitHub permissions;
- security practices;
- subprocessor list;
- privacy/data lifecycle;
- vulnerability disclosure;
- incident/status links;
- compliance reports/certifications only when actually obtained.

## Required pre-GA evidence

- final production GitHub App manifest;
- real two-installation isolation evidence;
- private/fork safe-execution evidence;
- OIDC claim validation evidence;
- restore/load/failure-recovery evidence;
- artifact authorization/retention/deletion behavior;
- public docs matching deployed behavior;
- security contact and incident process.

Detailed implementation ownership remains in issues/ADRs/security docs rather than this strategy summary.
