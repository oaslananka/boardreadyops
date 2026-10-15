# Opt-in target-repository manufacturing export and signed attestation

**Status:** Implemented target-runner Action/CLI, reviewed workflow **template**, and independently validated **public target-repository canaries** ([run #38026832338](https://github.com/boardreadyops/gateway-board-demo/actions/runs/38026832338)). This is **not GA acceptance**. The remaining customer scope is tracked by [#771](https://github.com/oaslananka/boardreadyops/issues/771), with two unrelated private GitHub App installations separately required by [#154](https://github.com/oaslananka/boardreadyops/issues/154). Release and production publication remain on hold.

## Trust model

The **customer target repository**, not the BoardReadyOps service, generates and signs the board fabrication bytes. A protected target branch's `workflow_dispatch` run checks out the exact GitHub-assigned commit `${{ github.sha }}`, runs the reviewed, SHA-pinned BoardReadyOps composite Action, exports actual KiCad 10 Gerber and Excellon drill files from the clean tracked source, and computes SHA-256 checksums for **every generated output plus `manifest.json`**. `actions/attest` signs that exact subject set with the target workflow's short-lived GitHub OIDC/Sigstore identity. The artifact uploader preserves the generated manifest and bytes inside the target's own Actions data boundary.

This does **not** require BoardReadyOps-held signing credentials, server-side private source copies, new GitHub App permissions or a managed worker fleet. Source SHA and ref come from the GitHub Actions environment, not from a user-supplied commit string. A dispatch on an unprotected ref, on a fork, in a self-hosted runner, from another event type or with a dirty/mismatched checkout fails **before** export. No `pull_request` triggers: GitHub's synthetic merge SHAs and unreviewed workflow edits must not be treated as source approval.

**Unsupported** means unsigned/unverified, never "source-bound verified." GitHub **API-hosted artifact attestations** in private/internal repositories require **GitHub Enterprise Cloud**; GitHub Enterprise Server is not supported. A separate opt-in **GitHub-internal signed offline-bundle** template below can avoid this particular API storage restriction without publishing to the public Rekor log. It is **not** an authorization bypass: the existing strict source-identity verifier and protected-branch requirement still apply. GitHub Free private repositories do not offer protected branches, so a signature there does not by itself satisfy strict reviewed-source release acceptance. Do not grant extra permissions or treat an unsigned or unprotected source as verified.

## Reviewed target-repository setup

1. The target repository owner chooses an appropriate protected branch with its KiCad board, an explicit tracked `*.kicad_pro` project, and `boardreadyops.yml`. Commit an ignore rule for `build/boardreadyops-attested/` so generating files never changes the reviewed Git worktree. Confirm that GitHub artifact attestations are available for the repository's visibility/plan, that GitHub Actions is enabled, and that the workflow will use GitHub-hosted Linux and KiCad **10.0.x**.
2. Copy [the reviewed opt-in target workflow](../../examples/github/workflows/boardreadyops-manufacturing-attested.yml) to `.github/workflows/boardreadyops-manufacturing-attested.yml` in the **target repository**. The template initially pins the immutable implementation PR-head commit for auditability; replace that example pin with the **owner-reviewed protected-merge commit SHA** that contains `.github/actions/manufacturing-attested-export/action.yml` before commissioning. Do not use `main`, tags or an unreviewed SHA. Replace `hardware/board.kicad_pro` with the real reviewed target `.kicad_pro` path. Review all workflow permissions and SHA-pinned third-party actions.
3. Commit the workflow and its ignore rule by normal protected-review procedure. Dispatch **`workflow_dispatch` on that protected branch**. Do not invent a workflow success when GitHub skipped or rejected the job. The Action enforces the protected-ref, fork, runner, event, commit and source integrity checks again as a runtime failure.
4. Successful runs generate `build/boardreadyops-attested/manifest.json`, `gerbers/*` and `drill/*`, a temporary checksum file for `actions/attest@v4` and the target repository's `reviewed-manufacturing-export` Actions artifact. The attestation is stored in the target repository's GitHub attestation API and identified by the signing workflow/run/attempt. The signer step is the **target workflow**, not a centrally dispatched signing service. The reusable/composite BoardReadyOps export Action does not possess `id-token` itself and does not sign.
5. Preserve target run ID, attempt, exact repository numeric ID, protected workflow path, source ref and commit, and attestation ID or bundle **from the independently authorized GitHub provider/installation record**. Never derive authorization from the unsigned manifest, an upload, a callback or the checksum file. Review the generated KiCad bytes as manufacturing data, not merely an attested digest.

## GitHub-internal offline bundle — no Enterprise attestation API storage

For an **opt-in, owner-controlled bundle**, use
[`boardreadyops-manufacturing-internal.yml`](../../examples/github/workflows/boardreadyops-manufacturing-internal.yml)
in the target repository instead of the standard `actions/attest` template.
It preserves the **same** protected SHA, clean Git tree, real KiCad 10 generation,
manifest and complete Gerber/drill SHA-256 subject inventory. The private-compatible
signer calls GitHub's official `@actions/attest@3.2.0` library with
`attestProvenance({ subjects, token: githubToken, sigstore: "github", skipWrite: true })`.
This requests GitHub's **internal** Sigstore certificate and signed timestamp,
without a GitHub Attestations API write and without public Sigstore/Rekor log
upload. Neither a long-lived signing key nor an extra repository permission
is required; the workflow limits permissions to `contents: read` and
`id-token: write`.

The workflow uploads two **separate, target-owned GitHub Actions artifacts**:
`reviewed-manufacturing-export` (the manifest and real manufacturing bytes)
and `reviewed-manufacturing-internal-attestation` (the signed Sigstore JSON
bundle). The signer requires zero public transparency-log entries, at least
one GitHub RFC 3161 timestamp and no GitHub API attestation ID; any deviation
fails the job. This **does not mean no third-party access**: GitHub operates
the internal signer and stores the target's artifact. The standard workflow
may still consume metered private GitHub-hosted Actions minutes and storage.
Before any private execution, check the owner's remaining included quota,
billing controls, and artifact retention. No plan upgrade or paid private
runner execution is required to develop or independently test the mechanism.

**Strict gate remains fail-closed on GitHub Free private repos:** The
source-bound export Action requires `github.ref_protected == true` and a
reviewed protected-branch `workflow_dispatch`; GitHub Free does **not**
support branch protection on private repositories. Removing this guard would
change the trust contract. Therefore the **signing transport** has a
non-Enterprise option, but the **reviewed-commit authority** remains blocked
on that plan until an independently trusted and accepted approval mechanism
is provided. No user-facing verified badge or strict release PASS is
authorized on that basis alone.

After downloading the target's reviewed Git checkout and **both** artifacts,
pass the bundle path explicitly to the **existing** independent verifier
(the bundle is not assumed to exist in the GitHub Attestations API):

```bash
boardreadyops verify-export-attestation . \
  --manifest build/boardreadyops-attested/manifest.json \
  --bundle ./boardreadyops-internal-export.sigstore.json \
  --repository OWNER/PRIVATE-REPO --repository-id 123456 \
  --reviewed-source-sha 0123456789abcdef0123456789abcdef01234567 \
  --source-ref refs/heads/main \
  --workflow .github/workflows/boardreadyops-manufacturing-internal.yml \
  --event workflow_dispatch --run-id 123456789 --run-attempt 1
```

Get the repository's **numeric ID**, reviewed commit and exact run/attempt
from an independently authorized GitHub provider record; do not accept
those values from the supplied manifest or unsigned bundle. The existing
verifier enforces GitHub OIDC issuer, **GitHub-internal** Sigstore trusted
root/timestamp, source SHA, branch, signer workflow, GitHub-hosted runner,
repository ID and all subject digests. It rejects altered outputs, replayed
attempts, unrelated signers and incomplete bundles. The `eligible`
prerequisite is **not** a GA badge or customer tenant/rollout approval.

**Public-only live proof of the mechanism:** The owner-B synthetic repository
`oaslananka-dev/boardreadyops-provenance-canary` executed the same library
with explicit `sigstore: "github"` and `skipWrite: true`, generating a
signed GitHub-internal bundle on
[run #38789820028](https://github.com/oaslananka-dev/boardreadyops-provenance-canary/actions/runs/38789820028).
Independent `gh attestation verify --bundle --no-public-good` and
BoardReadyOps `verify-export-attestation --bundle` verified **27/27**
Gerber/drill/manifest subjects, exact repository ID, SHA and run/attempt.
The 11,380-byte bundle had **zero Rekor entries**, **one RFC 3161 signed
timestamp**, and no attestation API storage. This verifies the crypto
mechanism, **not** availability of GitHub Free private branch protection
or an actual private Actions account/billing state. Private target acceptance
under #771/#154 remains open.

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

The verifier rejects signed evidence from `push`, `pull_request`, tag and PR refs: this opt-in authority is limited to a protected-branch `workflow_dispatch` run. Its expected target run must still be independently authorized; the certificate alone does not prove that branch protection was enforced at execution time.

The optional `--bundle <path>` is only an attestation bundle transport, not an independent trust anchor. The verifier must successfully validate the Sigstore signature and GitHub OIDC certificate **and** the exact expected immutable source identity, repository ID, protected workflow signer, run ID/attempt and **all** signed manifest/output digests. Exit 0 and `{"status":"eligible"}` mean that this opt-in cryptographic evidence prerequisite matched; **they do not independently authorize a GA badge, release, production gate or two-owner tenancy acceptance**. Any mismatch, unsupported provider, missing artifact, changed source or missing verification fails closed.

`boardreadyops generate . --reviewed-source-sha <sha>` and `boardreadyops export-checksums . --manifest <path> --reviewed-source-sha <sha>` are low-level tooling, not public strong-provenance decisions; the first demands a clean, exactly pinned Git checkout and the second recomputes the manifest and all actual outputs before returning an unsigned signing-input list.

## Validation and remaining acceptance

The local integration suite executes the **same composite Action shell** against a temporary, locally committed KiCad fixture with real `kicad-cli 10.0.x`, tests generated Gerber/Excellon and manifest bytes, and exercises negative commit/ref/runner/fork/dirty/ignored-output cases. Static tests verify the opt-in template's GitHub Action and OIDC signing order. This proves local functionality and contract coverage, **not a real GitHub-signed target artifact**.

**Existing real public canary:** The independently owned
`boardreadyops/gateway-board-demo` [workflow run #38026832338](https://github.com/boardreadyops/gateway-board-demo/actions/runs/38026832338)
completed with a protected `workflow_dispatch`, exact source commit and real
KiCad 10 Gerber/Excellon exports. Recorded online and offline Sigstore
verification checked 27 signed subjects; negative repository, SHA, run,
attempt, signer and tampered-output cases were rejected. This establishes a
single public target's opt-in cryptographic prerequisite, **not** the
remaining two unrelated private-installation acceptance (#154), a universal
customer-facing trust state or GA/release authorization.

For each further target, independently authorize the exact run and verify its
signed bundle, actual artifact digests and negative cases. Complete #154's
separate two-owner isolation requirements before claiming customer GA.
Manual/offline packages remain inspectable at byte-consistent-only or
unverified trust.
