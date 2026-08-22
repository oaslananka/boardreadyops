# PR-Native Hardware Change Impact v1 Design

**Date:** 2026-08-22
**Issue:** #447 — `product: add PR-native hardware change impact v1`
**Status:** Approved design
**Scope:** Target-repository GitHub Actions path and its existing Check Run / optional PR-comment publication surfaces

## 1. Problem

BoardReadyOps already has most of the primitives needed to answer a reviewer's core pull-request question: **what changed and why should I care?** The repository has:

- cross-run readiness, finding, BOM, and manufacturing-output diff logic;
- previous BoardReadyOps artifact discovery in the target repository;
- a compact sticky PR review comment;
- hosted Check Run completion and optional PR-comment publication;
- machine-readable terminal-result contracts; and
- a target-repository execution model that intentionally keeps source, workflow logs, and GitHub Actions artifacts inside the customer's repository boundary.

The missing product layer is a single deterministic impact model that combines those existing facts, separates observed facts from derived risk conclusions, binds the comparison to the pull request's exact base and head commits, and renders the same meaning in the PR-native surfaces without expanding the production GitHub App permission model.

## 2. Goals

PR-native hardware impact v1 MUST:

1. compare the pull request's **exact base SHA** with its **exact candidate/head SHA**;
2. distinguish observed change facts from deterministic impact/risk assessment;
3. reuse existing diff primitives rather than creating a second BOM/finding/readiness diff engine;
4. surface a concise impact summary in the GitHub review experience;
5. preserve a bounded machine-readable impact object for hosted publication and downstream reporting;
6. keep source, raw baseline artifacts, workflow logs, and GitHub Actions artifacts inside the target repository boundary;
7. preserve current private/fork safe-mode and least-privilege behavior; and
8. remain backward-compatible with runners and result producers that do not yet emit hardware impact.

## 3. Non-goals

v1 does NOT:

- use AI or probabilistic reasoning as a decision source;
- infer a baseline from "latest successful run", default branch history, timestamps, or another branch when the exact PR base SHA is unavailable;
- add firmware-specific or policy-specific comparison semantics before reliable v1 facts exist for those domains;
- add a broad dashboard redesign;
- move source, raw BoardReadyOps JSON artifacts, or target-repository logs into the cloud control plane;
- require new GitHub App permissions;
- change release gating or Check Run conclusion solely because an impact baseline is unavailable; or
- claim that a hardware change is safe merely because no v1-supported domain changed.

## 4. Key decision: exact-base comparison semantics

The comparison identity is immutable:

- `baseline.sha` MUST equal the pull request's exact base commit SHA.
- `candidate.sha` MUST equal the exact commit analyzed by the current BoardReadyOps run.

A previous artifact is eligible only when it can be bound to the exact base SHA. A completed BoardReadyOps result from another SHA MUST NOT be silently substituted, even when it is newer, successful, on the base branch, or the most recent artifact available.

If exact-base evidence cannot be resolved, impact generation is **fail-soft but explicit**:

- the normal current-run analysis, release decision, and existing Check Run conclusion continue unchanged;
- the hardware-impact object records `baseline.status = "unavailable"` and a bounded reason;
- renderers state that exact-base comparison evidence is unavailable; and
- no fallback comparison is presented as authoritative change impact.

This keeps the semantic meaning of "what changed in this PR" stable and deterministic.

## 5. Architecture

### 5.1 Recommended placement

Hardware impact is computed in the **target-repository Action execution boundary**.

The target repository already has access to:

- the exact PR context;
- the exact candidate checkout;
- prior BoardReadyOps artifacts through the repository-scoped GitHub Actions token; and
- the current `RunResult` including findings, readiness, fabrication/BOM snapshot, and output digests.

The Action resolves exact-base evidence, calculates the impact model, renders the local PR review representation, and publishes only the bounded structured impact result through the existing terminal-result path.

The cloud control plane does not download the baseline artifact and does not perform source-level comparison.

### 5.2 Existing primitives to reuse

Implementation should compose the current code instead of duplicating it:

- `src/core/diff/run.ts` — cross-run readiness, findings, and fabrication diff;
- `src/core/diff/fabrication.ts` — BOM and manufacturing-output facts;
- `src/action/previous-result.ts` — repository-local historical result artifact discovery;
- `src/report/review-comment.ts` — compact PR review rendering;
- `packages/contracts/src/index.ts` — bounded terminal-result schema;
- `apps/web/lib/readiness-result-format.js` — hosted Check Run / PR-comment formatting; and
- `apps/web/app/api/v1/runs/result/route.ts` — result persistence/publication pipeline.

No new external dependency is required.

## 6. Data model

### 6.1 Top-level model

The conceptual TypeScript contract is:

```ts
type HardwareImpactDomain = "readiness" | "findings" | "bom" | "manufacturing";
type HardwareImpactRiskDirection = "increased" | "decreased" | "unchanged" | "unknown";

type HardwareImpactBaseline =
  | {
      status: "available";
      sha: string;
    }
  | {
      status: "unavailable";
      sha: string;
      reason: "not-found" | "invalid-artifact" | "unsupported-result" | "candidate-mismatch";
    };

interface HardwareImpactV1 {
  version: 1;
  baseline: HardwareImpactBaseline;
  candidate: {
    sha: string;
  };
  facts: HardwareImpactFacts;
  assessment: HardwareImpactAssessment;
  evidence: HardwareImpactEvidenceRef[];
}
```

The persisted/public terminal-result representation is optional. Existing producers without `hardwareImpact` remain valid.

### 6.2 Facts versus assessment

`facts` MUST contain only observed deterministic deltas. It MUST NOT contain labels such as "dangerous", "safe", or "important".

```ts
interface HardwareImpactFacts {
  readiness: {
    previousScore: number | null;
    currentScore: number | null;
    scoreDelta: number | null;
    previousStatus: "ready" | "at-risk" | "blocked" | null;
    currentStatus: "ready" | "at-risk" | "blocked" | null;
    statusChanged: boolean;
  };
  findings: {
    added: number;
    resolved: number;
    addedBlocking: number;
    resolvedBlocking: number;
  };
  bom: {
    added: number;
    removed: number;
    changed: number;
    truncated: boolean;
  };
  manufacturing: {
    outputsAdded: number;
    outputsRemoved: number;
    outputsChanged: number;
  };
}
```

`assessment` MUST be derived only from the normalized facts and bounded evidence references:

```ts
interface HardwareImpactAssessment {
  materialChange: boolean;
  riskDirection: HardwareImpactRiskDirection;
  affectedDomains: HardwareImpactDomain[];
}
```

### 6.3 Evidence references

The full diff remains in the repository-owned JSON/report artifact. The hosted impact payload carries only bounded evidence references sufficient to explain the summary.

```ts
interface HardwareImpactEvidenceRef {
  domain: HardwareImpactDomain;
  kind: "finding" | "bom-row" | "output" | "readiness";
  label: string;
  path?: string;
  ruleId?: string;
  severity?: string;
}
```

Rules:

- at most **12** evidence references are emitted;
- each `label`, `path`, and `ruleId` is bounded to **256 characters**;
- `severity` uses the existing known finding severity vocabulary;
- no source text, artifact bytes, GitHub token, OIDC token/claim, installation token, webhook payload, or arbitrary environment value is included;
- references are selected after deterministic sorting, never by discovery timing; and
- evidence references are explanatory only and do not alter the assessment after the normalized facts have been computed.

## 7. Exact-base resolver

### 7.1 Resolver input

The Action's resolver receives:

- repository owner/name;
- PR base SHA;
- trusted PR head/candidate SHA;
- actual analyzed checkout SHA;
- current workflow run ID and workflow identity;
- configured BoardReadyOps artifact name; and
- the existing repository-scoped GitHub token.

### 7.2 Eligibility

A historical result is eligible only if:

1. the current analyzed checkout is bound to the trusted PR head SHA;
2. it is a valid BoardReadyOps JSON result supported by the current parser;
3. its associated workflow run can be bound to the exact requested base SHA;
4. it belongs to the same BoardReadyOps workflow identity used for the candidate comparison;
5. it is not the current candidate run; and
6. its comparison data are structurally valid.

The resolver MUST NOT select a result merely because it is on the base branch. The exact workflow `head_sha` binding is authoritative for v1. If several valid artifacts exist for the same exact base SHA and workflow identity, candidates are sorted by GitHub run ID descending and the first valid result is selected. API pagination/discovery order MUST NOT affect the choice.

### 7.3 Unavailable reasons

The resolver exposes only bounded categories:

- `not-found` — no exact-base BoardReadyOps artifact was found;
- `invalid-artifact` — exact-SHA candidate artifacts existed but none produced a valid BoardReadyOps result;
- `unsupported-result` — the exact-base result is BoardReadyOps data but cannot provide the comparison model required by this implementation version;
- `candidate-mismatch` — the analyzed checkout SHA is not the trusted pull request head SHA, so an exact base→head claim cannot be made.

Raw parse errors, GitHub response bodies, filesystem paths outside the repository-owned artifact workspace, and request details are not copied into the impact payload.

## 8. Deterministic impact assessment

Assessment is a pure function. After the resolver has selected the exact baseline evidence, the same normalized baseline and candidate facts MUST produce the same result independent of wall-clock time, GitHub API pagination order, locale, or host platform.

### 8.1 Affected domains

A domain is included only when its observed facts changed:

- `readiness` — score/status changed;
- `findings` — finding set changed;
- `bom` — at least one BOM row was added, removed, or changed;
- `manufacturing` — at least one manufacturing output was added, removed, or changed.

`affectedDomains` is emitted in the fixed order:

1. `readiness`
2. `findings`
3. `bom`
4. `manufacturing`

### 8.2 Material change

`materialChange` is true when at least one supported v1 domain is affected.

It is false only when the exact-base comparison is available and all supported facts are unchanged.

When the baseline is unavailable, the assessment MUST use:

- `materialChange: false`; and
- `riskDirection: "unknown"`.

Renderers MUST pair that state with the explicit baseline-unavailable message so `materialChange: false` is never presented as proof of no change.

### 8.3 Risk direction

Risk direction uses a precedence model.

#### Increased

`riskDirection = "increased"` when any of these are true:

- readiness status worsens (`ready → at-risk|blocked` or `at-risk → blocked`);
- readiness score decreases;
- one or more new blocking findings appear; or
- a previously passing run becomes failing when that conclusion is present in the reused `RunDiff` input.

#### Decreased

`riskDirection = "decreased"` only when:

- no increase condition is present;
- at least one explicit risk-reduction signal exists, such as readiness score/status improvement, resolved blocking findings, or failing-to-passing conclusion; and
- there is no unresolved direction conflict among the supported risk signals.

#### Unknown

`riskDirection = "unknown"` when:

- exact-base evidence is unavailable; or
- material facts changed but supported v1 risk signals cannot establish whether risk increased or decreased; or
- risk-reduction and risk-increase signals conflict in a way the deterministic precedence rules above do not resolve safely.

The implementation MUST prefer `unknown` over inventing a neutral or safe interpretation.

#### Unchanged

`riskDirection = "unchanged"` only when exact-base evidence is available, no increase/decrease signal exists, and the supported material facts are unchanged.

## 9. Stable ordering

All externally visible arrays and bounded evidence selections MUST use stable ordering before truncation.

- domains use the fixed order defined above;
- findings sort by severity rank, then rule ID, path, fingerprint;
- BOM facts sort by source/reference identity using the existing fabrication diff ordering;
- output facts sort by output kind, then stable path identity where a path-level reference is emitted;
- evidence references sort by domain, kind, then normalized label/path/rule ID.

Timestamps remain provenance metadata and MUST NOT participate in impact decisions or ordering.

## 10. Action data flow

For a pull-request run:

1. BoardReadyOps analyzes the exact candidate checkout and creates the current `RunResult` as today.
2. If impact generation is applicable, the Action obtains the exact PR base SHA and exact head SHA from trusted GitHub context and verifies the actual analyzed checkout is that exact head SHA.
3. If the analyzed checkout does not match the trusted PR head SHA, the Action emits `candidate-mismatch` and does not claim an authoritative PR diff.
4. Otherwise, the exact-base resolver searches repository-owned BoardReadyOps artifacts for a valid result bound to the base SHA and same workflow identity.
5. When available, the current `diffRuns(previous, current)` primitive produces the normalized cross-run diff.
6. The hardware-impact builder converts that diff into `HardwareImpactV1` facts, deterministic assessment, and bounded evidence references.
7. The full report artifact includes the structured impact model for downstream repository-local consumption.
8. `comment-format: review` receives the same impact object and renders a `Hardware impact` section.
9. The hosted target-repository workflow includes the optional bounded `hardwareImpact` object in the terminal result sent through the existing authenticated callback.
10. The cloud validates and persists the bounded object, then uses the same facts/assessment semantics in Check Run and optional PR-comment formatting.

If candidate binding or exact-base evidence cannot be established, the builder produces the explicit unavailable representation rather than substituting another baseline.

## 11. PR and Check Run presentation

### 11.1 Summary

When exact-base evidence is available, the first line should be compact and scannable, for example:

```text
Material change · risk increased · 3 affected domains
```

The summary is generated from the structured model, not independently inferred by each renderer.

### 11.2 Changed facts

The PR/Check Run surface includes a bounded `Changed facts` section with human-readable equivalents of the structured counters, for example:

```text
- Readiness: 82 → 71 (-11)
- Findings: +2 / -1; 1 new blocker
- BOM: 3 changed rows
- Manufacturing: 1 changed output
```

Zero-change facts may be omitted from the human-facing summary while remaining explicit as zero counters in the machine-readable model.

### 11.3 Impact assessment

A separate `Impact assessment` section exposes:

- risk direction;
- whether a material v1-supported fact changed; and
- affected domains.

This visual separation is required so users can distinguish **what changed** from **BoardReadyOps' deterministic interpretation of those changes**.

### 11.4 Baseline unavailable

When exact-base evidence is unavailable, renderers show:

```text
Hardware impact: Exact base SHA evidence unavailable; the current run result is still valid, but no authoritative PR change comparison was produced.
```

The bounded unavailable reason may be included in machine-readable output and developer-facing diagnostics, but the user-facing message must not imply that another run was used as a substitute.

## 12. Hosted result contract and persistence

`hardwareImpact` is added as an **optional** property to the existing release terminal-result contract.

Contract requirements:

- strict schema validation remains enabled;
- `version` is exactly `1`;
- SHA values are lowercase 40-character hexadecimal strings;
- enums are closed;
- evidence array length is capped at 12;
- bounded string limits from this design are enforced;
- unexpected keys are rejected by the nested strict schema;
- old payloads without `hardwareImpact` continue to parse unchanged.

Persistence MUST keep the structured object associated with the run/result in a tenant-scoped location already governed by the release-run result boundary. It MUST NOT create a new cross-tenant lookup path.

If DB representation changes require a migration, the migration must be additive/backward-compatible and safe for old/new application overlap during deployment.

## 13. Security and privacy

### 13.1 GitHub permissions

No new GitHub App permission is justified by this feature.

- historical artifact lookup occurs in the target repository Action using the workflow's repository-scoped token;
- the production App remains on the reviewed least-privilege profile used for dispatch and Check Run publication;
- optional PR comments remain optional and continue to require their separately reviewed write permission path.

### 13.2 Repository boundary

The following remain in the target repository boundary:

- source checkout;
- raw previous/current BoardReadyOps JSON artifacts;
- GitHub Actions logs;
- workflow artifacts; and
- exact detailed fabrication diff output.

The cloud receives only the bounded terminal result and optional `HardwareImpactV1` summary/evidence references.

### 13.3 Fork/private safe mode

Existing safe-mode decisions are authoritative and unchanged.

This feature MUST NOT:

- request broader permissions to obtain impact evidence;
- bypass fork restrictions when previous artifacts are unavailable;
- enable managed artifact publication in a path where safe mode disables it; or
- turn a missing impact baseline into a reason to execute repository-provided code with broader trust.

### 13.4 Injection and output safety

All human-rendered evidence strings continue through the existing Markdown/inline sanitization rules. New impact formatters must not interpolate raw JSON, raw GitHub response bodies, HTML, workflow expressions, or environment values directly into Markdown/Check Run text.

## 14. Error handling

Impact generation is secondary to the current-run release decision.

Expected baseline-discovery failures produce the explicit unavailable state and do not fail the analysis.

Unexpected internal failures follow existing Action/report error conventions:

- they must not be silently swallowed if they indicate a programming or contract bug;
- secrets/raw response bodies must not be logged;
- the current-run result remains the source of truth when it was already computed successfully; and
- publication must not claim an impact comparison succeeded when impact construction failed.

Cloud validation remains fail-closed: a malformed supplied `hardwareImpact` causes the terminal-result request to fail schema validation rather than being accepted with partially trusted fields.

## 15. Backward compatibility

The feature is additive.

- `RunResult` artifact schema evolution must preserve current readers or version the added section compatibly.
- `ReleaseRunResult.hardwareImpact` is optional.
- older Actions/runners publishing existing v1 terminal results remain accepted.
- hosted formatters work with both absent and present hardware impact.
- no existing CLI command, public config key, REST endpoint path, Action input, or GitHub App permission is removed or renamed.

No breaking migration is part of this design.

## 16. Testing strategy

Implementation uses TDD around each behavior boundary.

### 16.1 Core model tests

Add tests covering:

- identical input produces deep-equal / stable serialized impact output;
- supported no-change comparison → `materialChange=false`, `riskDirection=unchanged`;
- readiness regression → increased;
- new blocking finding → increased;
- readiness/finding improvement with no increase signal → decreased;
- material BOM/output-only change without directional risk evidence → unknown;
- unavailable baseline → unknown with explicit unavailable reason;
- stable affected-domain and evidence ordering; and
- evidence truncation occurs only after deterministic sorting.

### 16.2 Exact-base resolver tests

Cover:

- exact base SHA with valid same-workflow artifact → available;
- analyzed checkout SHA different from trusted PR head SHA → `candidate-mismatch`;
- a newer successful run on the same branch but wrong SHA → rejected;
- latest head artifact on wrong SHA → rejected;
- current run ID/current candidate SHA → excluded;
- malformed exact-SHA artifact → `invalid-artifact`;
- unsupported BoardReadyOps result shape → `unsupported-result`;
- no exact-SHA artifact → `not-found`; and
- pagination/discovery order does not alter the chosen result.

### 16.3 Action integration tests

Cover:

- exact-base artifact produces a `Hardware impact` section in review mode;
- baseline unavailable produces the explicit unavailable message;
- baseline unavailable does not change the underlying current-run exit/conclusion;
- full report and review comment share the same model instead of recalculating semantics independently;
- fork/non-PR contexts preserve current no-comment/safe behavior; and
- no additional GitHub API permission surface is introduced.

### 16.4 Contract tests

Cover:

- existing result payload without `hardwareImpact` remains accepted;
- valid v1 hardware impact is accepted;
- invalid SHA, enum, string length, evidence count, extra keys, or version is rejected;
- unavailable and available baseline variants are mutually strict; and
- maximum bounded payload stays comfortably below the existing result-body limit.

### 16.5 Cloud formatter/publication tests

Cover:

- Check Run and optional PR comment show the same facts and assessment;
- unavailable baseline is rendered explicitly;
- evidence strings are sanitized through current output rules;
- result publication still uses installation/repository/run trust snapshots already enforced by the route; and
- malformed stored/received impact is never rendered as trusted comparison evidence.

### 16.6 Regression verification

Before merge, run the repository's applicable full gates, including:

- focused unit/integration suites;
- full unit suite;
- typecheck;
- lint;
- generated dist/action verification;
- package-size checks;
- documentation build/accessibility where docs are changed;
- Windows Node 22/24 matrix;
- KiCad integration where the CI risk profile selects it;
- CodeQL;
- Semgrep;
- Gitleaks/security gate;
- Sonar Quality Gate;
- Codecov patch/project gates; and
- post-merge `main` CI and GitHub Security alert counts.

No test, security rule, threshold, or coverage gate may be weakened to land this feature.

## 17. Documentation changes

Implementation documentation should update the existing surfaces rather than create parallel product guides:

- `docs/review-app.md` — explain `Hardware impact`, exact-base semantics, and baseline-unavailable behavior;
- `docs/action.md` / `docs/github-action.md` where artifact lookup behavior is described;
- `docs/deployment/github-actions-execution.md` — clarify that the detailed baseline artifact stays inside the target repository while bounded impact may be published to the control plane;
- report/JSON documentation if `RunResult` exposes the impact object in repository-owned output; and
- generated/reference docs only when required by existing generation rules.

## 18. Rollout and observability

The feature does not require a feature flag if it remains additive and fail-soft when baseline evidence is absent.

Rollout should verify:

1. unit/contract/security gates on the PR;
2. public target-repository canary with an exact-base artifact;
3. private target-repository canary under the existing safe-mode policy;
4. a deliberate baseline-unavailable canary/path showing no false comparison claim; and
5. post-merge Security counts remain zero and Check Run publication remains tenant-scoped.

Operational logs may record aggregate impact state such as `available/unavailable` and bounded reason enums. They must not log the raw baseline artifact or private evidence content.

## 19. Acceptance mapping for #447

| Issue acceptance criterion | v1 design response |
| --- | --- |
| Reviewer understands material hardware changes without manually comparing tools/artifacts | One PR-native `Hardware impact` summary combines readiness, findings, BOM, and manufacturing facts. |
| Changed facts are distinguished from derived impact/risk conclusions | `facts` and `assessment` are separate model fields and separate renderer sections. |
| Same inputs produce the same deterministic decision | Exact SHA binding, pure assessment rules, fixed ordering, and no timestamp/latest-run fallback. |
| PR output points to supporting evidence | Existing report/artifact links remain the detailed evidence source; bounded evidence refs explain the summary. |
| Model is extensible without making v1 depend on future domains | Closed v1 domains cover current reliable data; the model can version to add firmware/policy later without emitting fake v1 data. |

## 20. Definition of done

#447's implementation slice is ready for merge only when:

- exact-base resolver semantics are proven by tests;
- the deterministic `HardwareImpactV1` model exists and reuses current diff primitives;
- Action PR review output renders impact or explicit baseline-unavailable state;
- hosted terminal result accepts and validates the optional bounded impact object;
- hosted Check Run / optional PR comment render the same model semantics;
- current safe-mode and least-privilege boundaries remain unchanged;
- backward compatibility with old terminal-result producers is tested;
- all applicable local and GitHub CI/security gates pass on the final head; and
- post-merge `main` and GitHub Security are freshly verified.
