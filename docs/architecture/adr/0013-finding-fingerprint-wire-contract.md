# ADR-0013: Carry the finding fingerprint across the runner result wire contract

- **Status:** Accepted
- **Date:** 2026-08-27
- **Relates to:** [ADR-0011 — Continuous supply watch](0011-continuous-supply-watch.md), [Cloud data model](../cloud-data-model.md)

## Context

Tracking a finding across two runs — has it just appeared, does it persist,
was it resolved — needs a stable identity for that finding: something that
survives a re-run of the same rule against the same problem, independent of
run id or timestamp.

That identity already exists. `src/core/findings.ts::fingerprintFor` computes
a SHA-256 digest over a finding's `ruleId`, `project`, `resource.path`,
`resource.kind`, `message`, `location`, and `details`, and every finding
produced via `createFinding()` carries it as `Finding.fingerprint`
(`src/core/findings.ts:16-47`). `src/core/baseline.ts` already uses it for
local `new-only` baseline suppression, and `src/core/diff/run.ts::diffRuns`
already uses it to compute `added`/`resolved`/`unchanged` finding sets between
two `RunResult` objects — the diff engine behind `hardwareImpactV1Schema`.

None of that reaches the cloud. `findingSchema` in
`packages/contracts/src/index.ts` — the wire shape for a finding inside
`releaseRunResultSchema.findings` — carries only `ruleId`, `severity`,
`message`, `path`, and `project`. `hardwareImpactEvidenceRefSchema` — the
per-finding entries in `hardwareImpactV1Schema.evidence` — carries a bounded
text `label` and `ruleId`/`severity`/`path`, but no fingerprint either. Cloud
receives aggregate before/after counts and free-text evidence labels; it has
no way to recognize that a specific finding in one run is the same finding in
another.

Two things could not be missed while designing the fix:

- `findingSchema` is `.strict()`; `releaseRunResultSchema` is `.strict()`;
  the Action is consumed by release tag, so an old, already-deployed
  Action/CLI keeps sending findings without a fingerprint for as long as that
  tag stays in use. Any new field has to be optional and ignorable by an old
  sender's absence of it, not a new required field a strict schema would
  reject payloads over.
- `Finding.fingerprint` is not always `fingerprintFor`'s output.
  `FindingInput.fingerprint` is settable, and
  `src/core/plugin-loader.ts::normalizePluginFinding` accepts whatever string
  a plugin supplies (`packages/plugin-sdk`'s `PluginFinding.fingerprint` is
  unconstrained). A wire format that requires the exact
  `fingerprintFor` shape would break a plugin author's non-conforming value.

## Decision

Add `fingerprint: z.string().regex(/^[0-9a-f]{64}$/u).optional()` to
`findingSchema` and to `hardwareImpactEvidenceRefSchema`
(`packages/contracts/src/index.ts`), matching `fingerprintFor`'s SHA-256-hex
output format exactly, and thread `finding.fingerprint` through the two
places a `Finding[]` becomes wire payload:

- `src/cli/runner-pipeline.ts` — the intermediate `RunnerExecutionOutput`
  report built from the CLI's own JSON result file.
- `src/runner/worker.ts::terminalResultFromExecution` — the final
  `releaseRunResultSchema`-validated payload the runner submits.

At that second point, `worker.ts` validates the fingerprint against the wire
pattern before including it (`wireFingerprint()`) and omits it silently on a
mismatch, rather than letting a non-conforming plugin fingerprint fail
`releaseRunResultSchema.parse()` for the entire result. A plugin with a
custom fingerprint behaves exactly as it did before this change: no
fingerprint reaches cloud for its findings, nothing else breaks.

`src/core/diff/hardware-impact.ts::findingEvidence` passes
`finding.fingerprint` through unchanged, since `FindingRef` (from
`src/core/diff/run.ts`) already carries it — this is a one-line addition, not
new diff logic. `hardware-impact.types.ts`'s hand-maintained mirror of the
`HardwareImpactV1` shape gets the same field, kept manually in sync with the
zod schema as the existing pattern already requires (`src/core` avoids a
runtime dependency on `packages/contracts`'s `zod` dependency, so this
duplication is deliberate, not an oversight).

No change to `fingerprintFor`'s algorithm, no new fingerprinting logic, no
`hardwareImpactV1Schema` version bump. The primitive already existed; this
only stops discarding it at the process boundary.

## Consequences

### Positive

- Cloud now receives a stable identity per finding wherever the sender
  computes one, which is the primitive every later feature needing
  finding-level tracking (disposition, stale invalidation, an evidence
  ledger) depends on. None of those features are built by this change.
- Fully backward compatible: `fingerprint` is optional on both schemas, an
  old sender's payload validates exactly as before, and a non-conforming
  plugin fingerprint degrades to "absent" rather than failing the request.
- No new dependency, no new migration, no new algorithm to get wrong.

### Negative

- `findingSchema.findings` stays capped at 500 entries
  (`releaseRunResultSchema`); a fingerprint on each of up to 500 findings
  adds a fixed ~64 bytes per finding to the payload, negligible next to
  `message`'s 4000-char bound.
- Cloud still does nothing with the fingerprint yet — no storage, no
  cross-run lookup on the cloud side. That is deliberately out of scope here.

## Rejected alternatives

### A shorter, truncated identity (matching `releaseRunBomComponentSchema.identityKey`'s 16-hex-char pattern)

Rejected. `identityKey` is a *different* value with a different purpose — a
content-derived BOM component key computed independently in
`src/bom/identity.ts::stableComponentKey`, deliberately truncated because
sixteen hex characters is enough entropy for the number of components on a
board. `Finding.fingerprint` already exists as a full, untruncated SHA-256
digest with call sites depending on its exact value
(`src/core/baseline.ts`, `src/core/diff/run.ts`). Re-deriving a shorter
digest for the wire would create two different identifiers for the same
finding depending on which side computed it.

### A new `hardwareImpactV1Schema` version 2 with identity-aware diff state (`new`/`persistent`/`regressed`/`resolved`)

Rejected for this change. The additive optional field on the existing v1
evidence schema is sufficient to carry identity across the wire; building
the full diff-state model on the cloud side is real, separate work with its
own design surface (how disposition interacts with a `regressed` finding,
what "persistent" means across more than two runs) that belongs with the
review-domain work, not bundled into a plumbing fix.

## Rollout

1. **Done.** `findingFingerprintSchema` added to `packages/contracts`, used
   by both `findingSchema.fingerprint` and
   `hardwareImpactEvidenceRefSchema.fingerprint`.
2. **Done.** `src/cli/runner-pipeline.ts` and
   `src/runner/worker.ts::terminalResultFromExecution` forward the
   fingerprint, with `worker.ts` validating format before forwarding.
3. **Done.** `src/core/diff/hardware-impact.ts::findingEvidence` and
   `hardware-impact.types.ts` carry it through the impact-evidence path.
4. Cloud-side consumption (persisting fingerprints, cross-run lookup by
   fingerprint, the review-domain features that need it) is future work with
   its own design.
