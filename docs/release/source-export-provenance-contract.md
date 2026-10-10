# Source-to-Exported Manufacturing Artifact Proof — Design Contract

**Status (2026-10-10): [#771](https://github.com/oaslananka/boardreadyops/issues/771) remains OPEN. Local source preflight and opt-in attestation verification helpers exist, but the trusted target-runner flow, real signed attestation and GA acceptance are NOT implemented.** This page specifies a trust boundary; it does not make any current release blocking check stronger. Coordinate [#756](https://github.com/oaslananka/boardreadyops/issues/756) (approved versus produced output) and [#753](https://github.com/oaslananka/boardreadyops/issues/753) (internal artifact validation).

## The user question

> Did these exact fabrication bytes come from the source commit I am approving?

A structurally valid Gerber set can be months older than the KiCad board in the same review. A file hash can establish consistency with a manifest; a self-reported commit value does **not** establish who generated the bytes. Gerber X2 `TF.CreationDate` and Git commit timestamps are informational, not source-to-export evidence. A legitimate re-export of unchanged source may have a newer timestamp.

The user-facing outcome must not say “provenance verified” unless the *source commit, generation execution and output bytes* are all bound by a trusted execution identity. Missing or unsupported evidence must be **clearly advisory**, not a falsely exact PASS or a fabricated blocking stale-export allegation.

## Historical starting surfaces and gaps (audited at `dfde5490`)

- `src/release/generate.ts` writes a `GenerateManifest` (schema version 1) with optional `git.sha`, `recipe.hash`, KiCad version, and generated artifact hashes. It does **not** record the `sourceFingerprint` expected by `src/core/provenance.ts`.
- `src/core/provenance.ts:verifyExportProvenance` verifies a source fingerprint and hashes listed artifacts but compares a Git SHA **only when the caller supplies** `currentGitSha`.
- `src/rules/release/artifact-provenance.ts` calls the verifier without `currentGitSha`. Its normal manifest candidate is `build/boardreadyops-generate/manifest.json`, which is currently a different manifest contract. A self-claimed `git.sha` must not be treated as authenticated.
- The release evidence-bundle `manifest.json` is **another schema (version 2)**. `release sign/verify` can validate a pinned signer and included bytes; that alone does not prove the exporter used the reviewed KiCad source. An optional `--provenance-attestation` URI is not equivalent to the CLI independently verifying the attestation.

Do not conflate these three manifests or promote their existing “verified” statuses into a stronger source-commit attestation.

## Chosen trust levels for implementation

| Level | Preconditions | UI / gate behavior |
| --- | --- | --- |
| **Source-bound verified** | Pinned reviewed commit, clean source-input fingerprint, actual same-run KiCad generation, complete output set and hashes, independently validated trusted workflow identity/attestation | “Generated from this source revision” with exact SHA, workflow and artifact digest evidence; may satisfy a separately enabled strict release policy |
| **Byte-consistent only** | All listed artifact digests and source files agree with a *self-reported* manifest, but no trusted generator-to-commit execution attestation | “Package files are internally consistent; source-to-export link not verified”; never satisfy strict source-bound policy |
| **Unverified / insufficient** | Missing, unsupported or incomplete manifest, external upload without provenance or unsupported toolchain | Actionable low-confidence advisory with reason and recommended verified-export path |
| **Contradictory / tampered** | Trusted attestation subject mismatch, pinned commit mismatch, changed/missing declared outputs, source fingerprint mismatch or prohibited path traversal | Explicit mismatch and evidence; release may block according to reviewed policy, not timestamp heuristics |

These are *future product semantics*. Do not silently relabel the current `release.artifact-provenance` finding as source-bound verification.

## Authoritative same-run workflow (first supported strong path)

1. The **target repository GitHub Actions job** resolves the immutable commit being reviewed, installation/repository identity and attempt binding (not an unchecked mutable branch name, unrelated fork or synthetic merge SHA). Reject a dirty or ambiguous KiCad input state before generation.
2. Snapshot and hash the explicit KiCad input set with normalized root-relative paths and bytes. Record the resolved KiCad CLI binary/version and canonical recipe/options hash. Re-check the source fingerprint after generation to detect in-run changes.
3. Run `kicad-cli` **in that job** into an empty, controlled output root. Do not accept pre-existing `fab/` files as proof that a new export ran. Enumerate *every* output; record normalized paths, SHA-256 and sizes. Reject path escapes, symlink hops and unlisted/additional outputs under strict coverage.
4. Write an unambiguous **export-provenance manifest** with a discriminator (e.g. `kind: boardreadyops.export-provenance`), its own version, source repository/commit/input fingerprint, generator recipe/toolchain, output hash set, and execution identity/attempt. Do not confuse this version with the release evidence-bundle schema.
5. Bind the manifest **and the output artifact set** to the trusted job using a verifiable GitHub Artifact Attestation or equivalent trusted signing mechanism. The verifier must validate issuer, repository, workflow/run identity, immutable reviewed commit and attested subject digest against the actual bytes; a URL string alone is insufficient.
6. Verification independently recomputes all input/artifact hashes from the appropriate scoped workspace and compares the pinned review SHA. Only after all links pass may the result be **source-bound verified**. Failure/timeout/lost attestation must fail closed to uncertainty or mismatch, without inventing success.

Preserve the existing target-repository runner authority (ADR-0010); do not introduce a managed central worker fleet or a new long-lived credential path. Fork and unrelated-installation jobs must not borrow a different installation's trusted status. Respect scoped OIDC, nonce, attempt/replay and tenant authorization contracts.

## Existing outputs, offline teams and UX

Teams often upload manufacturing packages exported on their workstation. They must still be able to inspect Gerber, drill, geometry and vendor rules. Present a **Byte-consistent only** or **Unverified** status when the exporter-to-reviewed-commit link is absent, rather than blocking every legitimate manual re-export or falsely blessing it. The UI should show source SHA, export time (informational), KiCad version, artifact digest, linked GitHub run if independently verified, the reason trust is limited, and one clear “Generate from this commit” workflow affordance. A source mismatch is not inferred from timestamps.

An unsigned export manifest supplied alongside its Gerbers is an untrusted assertion even if the checksum list agrees. A local signed bundle establishes integrity only relative to an independently trusted public key; it is not automatically equivalent to a trusted review-run identity.

## Real KiCad byte-inventory integration evidence (not signed provenance)

`tests/integration/manufacturing-real-kicad-provenance.test.ts` runs actual KiCad
10.0.x `kicad-cli` Gerber and Excellon export against a temporary, locally
committed fixture. It checks the manifest against actual hashes and exercises
wrong reviewed SHA, tampered Gerber bytes, a missing drill output, unlisted
artwork and changed KiCad source. The existing KiCad 10 CI integration matrix
runs this regression; local runs may skip when KiCad 10.0.x is absent.
**A locally created Git commit and self-reported manifest are not an attestation.**
This test establishes only byte consistency and negative-case coverage. It does
not satisfy the separate signed, independently verified exact-commit/source/
workflow/run-attempt requirements of #771 or the two distinct installations
of #154. No new source-bound “verified” UI or release PASS is authorized by
this integration check.

## Reviewed-commit local export guard (pre-attestation prerequisite)

The `runGenerate` library accepts an opt-in `reviewedSourceSha` (a full
lowercase 40-character SHA) for trusted-runner development. Before deleting
anything or invoking KiCad, it requires the **explicit root to be the actual
Git checkout top level**, its HEAD to equal the pinned SHA, a clean worktree
(including untracked files), both Gerber and drill steps, source files inside
the root and an empty output directory. It rechecks the source snapshot,
Git state, step outcomes and actual file inventory after generation. All
fingerprinted KiCad source files must be tracked by that Git commit, including
files that Git would otherwise silently ignore. A dirty, stale, incomplete,
or byte-inconsistent run throws rather than emitting a
successful result. For this first implementation, output must be a separate,
Git-ignored directory **inside** the checkout because the local verifier
requires an in-root manifest. An external output directory is rejected before
writing, not silently promoted or moved across the trust boundary.

**Security limit:** `reviewedSourceSha` is supplied by the caller. A local Git
assertion alone cannot authenticate the installation, issuer, GitHub workflow,
run attempt or code that performed the export; it cannot create a signed
attestation. The guard does **not** enable a user-facing source-bound verified
state, alter manual/offline workflows or lift any strict production HOLD.
Only a separately verified GitHub/Sigstore attestation over the manifest AND
actual outputs with independently checked runner provenance can do so.

## Required acceptance before changing the release gate

- Valid unchanged source re-exported later must not be flagged stale based on time alone.
- Stale but well-formed Gerber/drill outputs from an old source revision must not receive source-bound verified status.
- Mutated KiCad input after generation, wrong `git.sha`, dirty checkout, moved/refetched PR SHA, fork cross-installation and replayed attempt must fail the strong trust boundary.
- Added, missing, truncated, reordered or replaced artifact bytes, path traversal, symlinks and mismatched attestation subjects must not be accepted as a complete trusted set.
- Generator schema, verifier input and rule acceptance must agree; migration of old manifests is explicit and **does not** silently upgrade their trust.
- Manual/offline uploaded packages remain inspectable with honest advisory status and a UI-visible way to request an authoritative export.
- Unit, adversarial, targeted GitHub Actions integration and two-unrelated-installation acceptance tests must pass, with both positive proof and deliberately forged near-misses.

## Delivery phases

**Phase 1 — contract and compatibility:** align generator, source fingerprint and verifier with a discriminated export schema. Define source-root discovery and Git environment sanitation. Add positive/negative tests. Preserve older manifests as *limited trust* rather than returning strong `verified` from optional fields.

**Phase 2 — source-bound attestation:** trusted target-repository, SHA-pinned same-run export + manifest/artifact subject verification, with issuer/repository/run constraints and replay protection. Fail closed on provider or toolchain uncertainty.

**Phase 3 — customer-facing release decision:** tenant-scoped policy choice and clear UI trust levels, audit trail and evidence navigation; strict block only when the approved strong policy applies. Document source-bound gate eligibility and manual-upload downgrade.

This design does not assert implementation, signed manufacturing attestations, or general availability. Track actual completion through issue #771 and exact-head CI evidence.

## Phase 2 library prerequisite: verify the attested export subject set

The opt-in `src/release/export-attestation.ts` library now provides two **non-release**
primitives. `prepareExportAttestationChecksums` rechecks a clean, pinned export
manifest and writes no files; its returned SHA-256 checksums text covers
`manifest.json` **and every Gerber, drill, and other generated output** with
root-relative subject names. An authorized target-repository job may write
that text to a separate checksums file **outside the generated-output tree**
and pass it to the officially supported `actions/attest` `subject-checksums`
input. The action supports at most 1,024 subjects, enforced by the helper.

`verifyReviewedExportAttestation` takes independently authorized expected
**repository name and numeric ID, reviewed commit SHA, source ref, workflow
path, triggering event, run ID and run attempt**. It first verifies actual
KiCad source bytes and the complete generated output inventory. It then
runs `gh attestation verify` with the exact repository, signer workflow,
signer/source commit digests, source ref, GitHub OIDC issuer, GitHub-hosted
runner requirement and the manifest's actual bytes. It accepts a result as
an **eligible piece of proof** only when the cryptographically verified
certificate also binds the expected repository ID, workflow, source commit,
ref, event, run/attempt, and the signed statement includes **exactly** the
manifest and every actual output hash, with no duplicates or extra subjects.

The expected identity values **must** come from an independently authorized
target-repository installation/run record and a reviewed workflow. They must
never be copied from the unsigned export manifest, untrusted workflow output,
a browser request, or an incoming callback. Verification of an arbitrary
attestation or a URL is not an authority check. The signed subject list
cannot substitute for a safe generator job: it must follow the opt-in
`reviewedSourceSha` preflight and recheck a clean and immutable source before
signing. A mutable checkout, other-repository workflow, PR synthetic merge,
untrusted fork, self-hosted job, or reused run attempt is not accepted as the
trusted path merely because a signature exists.

**Important availability limit (checked 2026-10-10):** GitHub's native
`actions/attest` supports public repositories on standard current plans,
but **private/internal repositories require GitHub Enterprise Cloud**.
That is not a general-purpose private-customer fallback. An alternate
independently authenticated signing/verifier transport for non-Enterprise
private targets is **not implemented**; do not promise or automatically
enable a source-bound gate there. Official references:
[GitHub attestation requirements](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
[actions/attest](https://github.com/actions/attest), and
[GitHub CLI verification policy](https://cli.github.com/manual/gh_attestation_verify).

**Current status:** these are library and adversarial-test prerequisites,
not a deployed target-repository job, actual signed export attestation,
two-installation acceptance, supported end-user strong verification state,
or release/GA approval. A positive library result must not directly change
a release policy or a tenant-facing badge. The actual identity authority,
protected runner/workflow, provider availability and independent customer
acceptance remain open under #771 and #154.


## Opt-in target-runner export and signature path (not GA-commissioned)

The [reviewed manufacturing export runbook](attested-manufacturing-export.md)
now documents a separately packaged composite Action and a target-repository
`workflow_dispatch` **template** under `examples/github/workflows/`. The
caller pins the immutable BoardReadyOps action commit; its protected,
GitHub-hosted target job checks out the exact `github.sha`, runs real KiCad 10
Gerber and Excellon generation with the opt-in `reviewedSourceSha` guard,
recomputes a manifest-plus-every-output checksum set and invokes SHA-pinned
`actions/attest` inside the **target** repository using that job's OIDC.
The associated CLI supports independent credentialed `gh attestation verify`
against explicit owner-authorized repository/run/attempt expectations.

This is an executable **integration contract** with local real KiCad validation,
not evidence that a customer has installed the template, signed an export, or
passed multi-installation acceptance. The template deliberately requires the
owner to replace a future immutable BoardReadyOps commit SHA and project path;
it must not be run against mutable refs. Private/internal native signing is
Enterprise Cloud-gated; other private targets remain unverified. No GA trust
level, release gate or production policy is changed by the mere existence of
these components; #771 and #154 remain open.
