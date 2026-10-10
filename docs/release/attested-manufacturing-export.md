# Opt-in target-repository manufacturing export and signed attestation

**Status:** Implemented target-runner action/CLI and reviewed workflow **template**; not commissioned or GA-accepted. This is tracked by [#771](https://github.com/oaslananka/boardreadyops/issues/771). Real two-owner GitHub App installation acceptance is separately tracked by [#154](https://github.com/oaslananka/boardreadyops/issues/154). Release and production publication remain on hold.

## Trust model

The **customer target repository**, not the BoardReadyOps service, generates and signs the board fabrication bytes. A protected target branch's `workflow_dispatch` run checks out the exact GitHub-assigned commit `${{ github.sha }}`, runs the reviewed, SHA-pinned BoardReadyOps composite Action, exports actual KiCad 10 Gerber and Excellon drill files from the clean tracked source, and computes SHA-256 checksums for **every generated output plus `manifest.json`**. `actions/attest` signs that exact subject set with the target workflow's short-lived GitHub OIDC/Sigstore identity. The artifact uploader preserves the generated manifest and bytes inside the target's own Actions data boundary.

This does **not** require BoardReadyOps-held signing credentials, server-side private source copies, new GitHub App permissions or a managed worker fleet. Source SHA and ref come from the GitHub Actions environment, not from a user-supplied commit string. A dispatch on an unprotected ref, on a fork, in a self-hosted runner, from another event type or with a dirty/mismatched checkout fails **before** export. No `pull_request` triggers: GitHub's synthetic merge SHAs and unreviewed workflow edits must not be treated as source approval.

**Unsupported** means unsigned/unverified, never "source-bound verified." GitHub native artifact attestations in private/internal repositories require **GitHub Enterprise Cloud**; GitHub Enterprise Server is not supported. There is no non-Enterprise private-repository fallback implemented in this tranche. Do not grant extra permissions or treat a non-attestable private repository as a success.

## Reviewed target-repository setup

1. The target repository owner chooses an appropriate protected branch with its KiCad board, an explicit tracked `*.kicad_pro` project, and `boardreadyops.yml`. Commit an ignore rule for `build/boardreadyops-attested/` so generating files never changes the reviewed Git worktree. Confirm that GitHub artifact attestations are available for the repository's visibility/plan, that GitHub Actions is enabled, and that the workflow will use GitHub-hosted Linux and KiCad **10.0.x**.
2. Copy [the reviewed opt-in target workflow](../../examples/github/workflows/boardreadyops-manufacturing-attested.yml) to `.github/workflows/boardreadyops-manufacturing-attested.yml` in the **target repository**. Replace `REPLACE_WITH_REVIEWED_40_CHAR_COMMIT_SHA` with the *immutable 40-character BoardReadyOps implementation commit* that contains `.github/actions/manufacturing-attested-export/action.yml`. Do not use `main`, tags or an unresolved placeholder. Replace `hardware/board.kicad_pro` with the real reviewed target `.kicad_pro` path. Review all workflow permissions and SHA-pinned third-party actions.
3. Commit the workflow and its ignore rule by normal protected-review procedure. Dispatch **`workflow_dispatch` on that protected branch**. Do not invent a workflow success when GitHub skipped or rejected the job. The Action enforces the protected-ref, fork, runner, event, commit and source integrity checks again as a runtime failure.
4. Successful runs generate `build/boardreadyops-attested/manifest.json`, `gerbers/*` and `drill/*`, a temporary checksum file for `actions/attest@v4` and the target repository's `reviewed-manufacturing-export` Actions artifact. The attestation is stored in the target repository's GitHub attestation API and identified by the signing workflow/run/attempt. The signer step is the **target workflow**, not a centrally dispatched signing service. The reusable/composite BoardReadyOps export Action does not possess `id-token` itself and does not sign.
5. Preserve target run ID, attempt, exact repository numeric ID, protected workflow path, source ref and commit, and attestation ID or bundle **from the independently authorized GitHub provider/installation record**. Never derive authorization from the unsigned manifest, an upload, a callback or the checksum file. Review the generated KiCad bytes as manufacturing data, not merely an attested digest.

## Independent verification after download

Restore the target's exact reviewed Git checkout (including `boardreadyops.yml` and its KiCad files) and extract the workflow artifact into `build/boardreadyops-attested/` relative to that checkout. Run the SHA-pinned BoardReadyOps CLI with `gh` authenticated for the target repository, or download the signed bundle through an independently authenticated GitHub path and pass `--bundle` for offline verification. Obtain every expected identity value from the **authorized target run**, not from the artifact being checked:

```bash
boardreadyops verify-export-attestation . \
  --manifest build/boardreadyops-attested/manifest.json \
  --repository ORG/REPO \
  --repository-id 123456 \
  --reviewed-source-sha 0123456789abcdef0123456789abcdef01234567 \
  --source-ref refs/heads/main \
  --workflow .github/workflows/boardreadyops-manufacturing-attested.yml \
  --event workflow_dispatch \
  --run-id 1234567890 \
  --run-attempt 1
```

The optional `--bundle <path>` is only an attestation bundle transport, not an independent trust anchor. The verifier must successfully validate the Sigstore signature and GitHub OIDC certificate **and** the exact expected immutable source identity, repository ID, protected workflow signer, run ID/attempt and **all** signed manifest/output digests. Exit 0 and `{"status":"eligible"}` mean that this opt-in cryptographic evidence prerequisite matched; **they do not independently authorize a GA badge, release, production gate or two-owner tenancy acceptance**. Any mismatch, unsupported provider, missing artifact, changed source or missing verification fails closed.

`boardreadyops generate . --reviewed-source-sha <sha>` and `boardreadyops export-checksums . --manifest <path> --reviewed-source-sha <sha>` are low-level tooling, not public strong-provenance decisions; the first demands a clean, exactly pinned Git checkout and the second recomputes the manifest and all actual outputs before returning an unsigned signing-input list.

## Validation and remaining acceptance

The local integration suite executes the **same composite Action shell** against a temporary, locally committed KiCad fixture with real `kicad-cli 10.0.x`, tests generated Gerber/Excellon and manifest bytes, and exercises negative commit/ref/runner/fork/dirty/ignored-output cases. Static tests verify the opt-in template's GitHub Action and OIDC signing order. This proves local functionality and contract coverage, **not a real GitHub-signed target artifact**.

Before granting a stronger customer-facing source-bound state or completing #771, run an eligible real, independently owned target-repository `workflow_dispatch`, collect actual signed bundle and checksum subject evidence, verify with the independent CLI and negative replay/different-repo/different-run tests, then meet #154's two distinct real installation owners. Manual/offline packages remain inspectable at byte-consistent-only or unverified trust.
