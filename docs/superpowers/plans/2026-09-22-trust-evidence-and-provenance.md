# Trust, Evidence, and Provenance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cloud publishing explicitly consented and data-classed, then bind every decision-relevant input into verifiable release evidence and provenance.

**Architecture:** Introduce one pure upload-policy contract shared by CLI and Action, one canonical evidence-identity builder, and one versioned provenance contract consumed by both export generation and verification. Gate evaluation consumes evidence strength separately from severity. Cryptographic origin claims reuse BoardReadyOps signing/trust primitives rather than inventing a second trust system.

**Tech Stack:** TypeScript, Vitest, GitHub Action runtime, BoardReadyOps CLI, Node crypto, existing release signing/provenance modules.

**Spec:** `docs/superpowers/specs/2026-09-22-assurance-hardening-program-design.md`

## Global Constraints

- `BOARDREADYOPS_TOKEN` never enables publishing by itself.
- Upload modes remain exactly `metadata | snapshots | source`.
- Metadata mode never generates snapshots.
- Evidence identity includes current generated product version and build identity.
- Generator and verifier use one provenance schema.
- Heuristic evidence is warning-only unless an explicit policy opts into blocking.
- Existing report/finding fingerprints remain stable unless their documented contract must change.

## Review Focus

- Empty upload input with a valid token must issue zero HTTP requests.
- Metadata mode must not call snapshot generation.
- A config file with identical path but changed content must change evidence digest.
- A generated manifest from `boardreadyops generate` must pass the production provenance rule.
- A heuristic high-severity finding must not block under the default policy.

---

### Task A1: Centralize cloud upload consent and data-class policy

**Files:**
- Create: `src/core/cloud-upload-policy.ts`
- Modify: `src/action/inputs.ts`
- Modify: `src/action/cloud-publish.ts`
- Modify: `src/cli/commands/review.ts`
- Test: `tests/action/cloud-publish.test.ts` or the closest existing Action publish test
- Test: `tests/unit/cli/review.test.ts` or the closest existing review command test

**Interfaces:**
- Produce:
```ts
export type CloudUploadMode = "metadata" | "snapshots" | "source";

export interface CloudUploadPolicy {
  enabled: boolean;
  includeSnapshots: boolean;
  includeSource: boolean;
}

export function resolveCloudUploadPolicy(
  mode: CloudUploadMode | undefined,
): CloudUploadPolicy;
```
- Action and CLI may read a token only after `enabled === true`.

- [ ] **Step 1: Write RED tests** for unset mode + token, metadata, snapshots, source, and missing token when a mode is requested.
- [ ] **Step 2: Run the focused Action/CLI tests** and confirm current behavior fails at least the unset-mode and metadata-snapshot cases.
- [ ] **Step 3: Implement `resolveCloudUploadPolicy`** as a pure exhaustive switch; unset returns all false.
- [ ] **Step 4: Change Action publishing** so `const isRequested = Boolean(inputs.cloudUpload || token)` no longer exists; mode controls enablement and token only authenticates an enabled request.
- [ ] **Step 5: Change CLI review** so `generateSnapshots(...)` is called only when `includeSnapshots` is true and raw source payload is assembled only when `includeSource` is true.
- [ ] **Step 6: Add request-body assertions** proving metadata payload contains no `snapshots` or source-class fields.
- [ ] **Step 7: Run focused tests to GREEN** and commit `fix(core): enforce explicit cloud upload policy`.

### Task A2: Build one canonical evidence identity

**Files:**
- Create: `src/core/evidence-identity.ts`
- Create: `scripts/generate-rule-pack-digest.mjs`
- Generate: `src/generated/rule-pack-digest.ts`
- Modify: `packages/cloud-core/src/review-diff.ts`
- Modify: `src/action/cloud-publish.ts`
- Modify: `src/cli/commands/review.ts`
- Modify: build/docs drift scripts as required
- Test: `tests/unit/core/evidence-identity.test.ts`
- Test: existing review-diff/evidence digest tests

**Interfaces:**
- Produce a typed input:
```ts
export interface EvidenceIdentityInput {
  schemaVersion: number;
  toolVersion: string;
  toolBuildCommit: string;
  rulePackDigest: string;
  configDigest: string;
  policyDigest: string;
  headCommitSha?: string;
  baseCommitSha?: string;
  kicadVersion?: string;
  findingFingerprints: readonly string[];
  artifactDigests: readonly string[];
  snapshotDigests: readonly string[];
  executionMode: string;
  uploadMode?: "metadata" | "snapshots" | "source";
}
```
- `computeEvidenceDigest` consumes only canonicalized `EvidenceIdentityInput`.

- [ ] **Step 1: Write RED mutation tests**: change each field independently and expect a new digest.
- [ ] **Step 2: Add a RED test** proving two configs at the same path with different bytes produce different `configDigest`.
- [ ] **Step 3: Generate rule-pack digest from rule source bytes** using sorted repository-relative paths plus file SHA-256 values; emit the digest into `src/generated/rule-pack-digest.ts`.
- [ ] **Step 4: Replace hard-coded `1.34.0`** with `boardReadyVersion` from `src/generated/version.ts`; bind build commit from existing build metadata or add a generated build-identity module.
- [ ] **Step 5: Hash loaded config/policy content**, not the resolved path string.
- [ ] **Step 6: Hash actual artifact and snapshot bytes** and feed those digests into both Action and CLI identities.
- [ ] **Step 7: Run generation twice** and assert clean-tree/idempotent output.
- [ ] **Step 8: Run evidence tests to GREEN** and commit `feat(core): bind complete evidence identity`.

### Task A3: Unify export provenance generation and verification

**Files:**
- Create: `schemas/export-provenance.schema.json`
- Modify: `src/core/provenance.ts`
- Modify: `src/release/generate.ts`
- Modify: `src/rules/release/artifact-provenance.ts`
- Test: `tests/unit/release/provenance.test.ts`
- Test: `tests/unit/rules/release/artifact-provenance.test.ts`
- Add integration test: `tests/integration/release/generate-provenance.test.ts`

**Interfaces:**
- Define one exported `ExportProvenanceManifest` contract with `schemaVersion`, `tool`, `generatedAt`, source fingerprint, optional git identity, and artifact digests.
- `boardreadyops generate` writes exactly that contract to `build/boardreadyops-generate/manifest.json`.
- `release.artifact-provenance` verifies exactly that contract.

- [ ] **Step 1: Write a RED integration test** that runs the real generate path and then the production artifact-provenance rule; current mismatch must fail.
- [ ] **Step 2: Add JSON Schema validation** for the shared manifest and unit-test malformed/missing source fingerprint.
- [ ] **Step 3: Change release generation** to call the canonical provenance constructor instead of its separate manifest shape.
- [ ] **Step 4: Keep recipe/environment/step diagnostics** either as optional schema fields or a separate generation report; do not create a second file named provenance manifest with incompatible semantics.
- [ ] **Step 5: Run generate → verify and require PASS.**
- [ ] **Step 6: Modify source bytes and artifact bytes independently** and require provenance FAIL in the same integration test.
- [ ] **Step 7: Commit `fix(release): unify generated provenance contract`.

### Task A4: Bind provenance to current commit and trusted origin

**Files:**
- Modify: `src/core/provenance.ts`
- Modify: `src/rules/release/artifact-provenance.ts`
- Reuse/modify: existing `src/release/signing*` and trust-store modules
- Test: provenance/signing suites
- Docs: provenance/release documentation that uses "authentic"

**Interfaces:**
- Production verifier passes resolved current Git SHA into `verifyExportProvenance`.
- Signed provenance wraps or references the canonical manifest digest; verification returns separate `integrityValid` and `originTrusted` results.

- [ ] **Step 1: Write RED tests** for current SHA match, mismatch, absent git identity, dirty-worktree policy, valid signature, invalid signature, and untrusted signer.
- [ ] **Step 2: Wire current SHA** from the repository git resolver into the production rule.
- [ ] **Step 3: Bind the canonical manifest digest** into the existing signing/trust-store path rather than creating a parallel key system.
- [ ] **Step 4: Return distinct verification states** so unsigned-but-content-consistent evidence is not described as authentic.
- [ ] **Step 5: Update rule metadata/docs** to use `content-consistent` unless `originTrusted === true`.
- [ ] **Step 6: Run tamper/signature tests to GREEN** and commit `feat(release): authenticate export provenance`.

### Task A5: Enforce evidence strength separately from severity

**Files:**
- Modify: `src/core/findings.ts`
- Modify: `src/core/rule-registry.ts` only if type normalization is needed
- Modify: config schema/default policy files
- Modify: report emitters to display evidence strength
- Test: `tests/unit/core/findings.test.ts`
- Test: policy/config tests
- Test: report snapshot tests

**Interfaces:**
- Gate evaluation accepts severity and `evidenceType: "exact" | "heuristic"`.
- Default policy never blocks on heuristic evidence.
- Explicit config may opt heuristic evidence into blocking.

- [ ] **Step 1: Write RED tests** for exact-medium blocking, heuristic-high warning, and explicit heuristic-block override.
- [ ] **Step 2: Extend gate policy schema** with an explicit heuristic policy rather than inferring it from severity.
- [ ] **Step 3: Update `shouldFail`/gate evaluation** to require both policy and evidence type.
- [ ] **Step 4: Surface evidence strength** in JSON/HTML/text output without changing stable finding fingerprints unless the schema contract requires it.
- [ ] **Step 5: Run snapshot/schema/docs generation** and commit `feat(core): enforce evidence-strength gating`.

### Task A6: Reconcile privacy/trust documentation and run the golden path

**Files:**
- Modify: `PRIVACY.md`
- Modify: `SECURITY.md`
- Modify: `docs/action.md`
- Modify: relevant GTM/security questionnaire documents
- Modify: provenance/release docs
- Test: add a documentation contract test if one exists; otherwise extend repository content-policy tests.

- [ ] **Step 1: Replace absolute data-boundary language** with mode-specific statements for local, metadata, snapshots, and source execution.
- [ ] **Step 2: Remove/qualify "zero-knowledge"** unless a cryptographic zero-knowledge protocol actually exists.
- [ ] **Step 3: Make external API/plugin language match runtime capabilities.**
- [ ] **Step 4: Run the real golden path:** generate → check → provenance verify → sign → verify.
- [ ] **Step 5: Run `test:action`, focused integration tests, coverage for touched core/rules, build, `verify:dist`, docs, structure, and full repository validation.
- [ ] **Step 6: Commit `docs: align trust claims with enforced behavior` and open a human-reviewed implementation PR.
