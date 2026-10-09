# Guided GitHub App onboarding flow

Issue: #16

## Goal

A repository owner should move from GitHub App installation to a useful first BoardReadyOps result with a small, reviewable setup surface and without provisioning a KiCad worker or a long-lived callback secret.

The target-repository GitHub Actions decision intentionally requires two committed files:

```text
.github/workflows/readiness-runner.yml
boardreadyops.yml
```

This is not zero-file onboarding: both files must exist in the target repository's reviewed default branch before analysis can run. The current GitHub App **does request `contents: write`, `workflows: write`, and `pull_requests: write`** for optional setup pull requests; these grants do not authorize default-branch writes. The App creates or updates only allowlisted files on a **new branch**, then opens a pull request subject to the customer's reviews and branch protection. Without the required write grants, the owner can copy the same generated files into their own pull request. The canonical permission list and degradation paths are in [GitHub App permissions](../security/github-app-permissions.md) and `githubAppPermissionProfile`.


## GitHub App setup URL handoff

The hosted `/setup` page is the post-installation [Setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url) for the GitHub App. Enable GitHub's redirect-on-update behavior so repository selection changes return the owner to the same reviewable setup flow.

GitHub includes an `installation_id` query parameter in this redirect. Treat it as untrusted: the public setup page does not display the value, does not use it to authorize repository access, and does not query installation or repository state from it. Repository-specific reads and mutations remain behind the authenticated, tenant-scoped control-plane API.

This handoff is intentionally informational. It leads the owner to preset selection, exact file review, and readiness validation without claiming that a spoofable redirect parameter proves installation ownership.

## First-result telemetry

First-result telemetry is derived from existing tenant-scoped, append-only operational evidence rather than a separate analytics payload. Setup changes, setup-probe requests, and validated setup revisions emit `github_app.repository.setup_changed`, `github_app.repository.setup_probe_requested`, and `github_app.repository.setup_validated` audit events. The accepted run, normalized result, Check Run publication, and bounded workflow identifiers continue through the normal run lifecycle evidence.

These records contain stable identifiers, preset and contract versions, setup status, timestamps, and bounded publication state. They do not add repository source, finding contents, design paths, workflow logs, credentials, OIDC tokens, or artifact bytes to onboarding telemetry.

## First-result path

1. Install the BoardReadyOps GitHub App.
2. Select repositories.
3. Review the exact readiness workflow and starter configuration, then choose an App-created setup pull request (when the installation permits it) or a manually authored pull request. Merge through the target repository's own branch protection; **the App never writes to the default branch**.
4. BoardReadyOps records the installation and repository.
5. A supported pull request event creates a queued release-readiness run and native Check Run.
6. The App dispatches the target repository's workflow.
7. GitHub Actions checks out the exact commit, installs KiCad, and runs BoardReadyOps.
8. The workflow sends normalized results through a run/attempt-bound GitHub OIDC callback.
9. The Check Run and hosted dashboard show the decision, findings, and GitHub Actions run link.

## Required UX surfaces

- GitHub App install success page.
- Repository setup page with four policy presets, exact configuration preview, canonical workflow path, permission review, and explicit setup steps.
- Versioned setup history and run-level policy provenance.
- Detection of missing workflow, disabled Actions, incompatible workflow metadata, missing or invalid configuration, expired or stale probes, and missing App Actions permission.
- A target-repository setup probe authenticated with repository/workflow/ref/probe-bound GitHub Actions OIDC.
- First run status page.
- PR Check Run output.
- Hosted run dashboard.

## Safe defaults

- The App requests `contents: write`, `workflows: write`, and `pull_requests: write` for **optional reviewed setup pull requests**; use the exact configuration/workflow path allowlist and never write directly to the default branch. When these grants are absent, fail closed on automated setup and show copy-ready manual instructions.
- Do not store a BoardReadyOps callback API key in target repositories.
- Do not dispatch draft or fork pull requests in the initial hosted profile.
- Keep source, logs, and workflow artifacts in the target repository.
- Use exact-SHA action pins and exact-SHA checkout verification.
- Use the prototype preset as the lowest-friction default; every preset remains visible and reviewable before it is committed.
- Do not dispatch repositories outside the installation selection and rollout policy.

## Fresh-repository acceptance boundary (#446)

The existing UI, configuration generator, app capability profile, OIDC setup probe, and telemetry helpers are **implementation evidence**, not measured activation. Do not mark a fresh installation validated solely because the public App registration advertises the expected grants: older installations may not have accepted newly requested permissions ([GitHub permission update semantics](https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app)). Each repository's actual installation grants must be resolved server-side before offering an automated setup action.

For a controlled fresh-repository validation, record the independently verifiable timestamps for first installation/selection, merge of the reviewed setup PR, setup probe completion, first accepted run, Check Run publication, and **first actionable finding**. Measure time to first useful finding from the initial installation/selection timestamp to the first actionable finding; a queued run or empty/pass-only result is not sufficient. The initial target is under 10 minutes; under 5 minutes is a subsequent optimization goal. Report elapsed time, status of each step and any missing permission or workflow error without recording board source, raw GitHub tokens, private paths or artifact bytes. Use distinct fresh repository/installation identities; do not reuse a configured demo repository as fresh-install evidence.

The existing `packages/cloud-core/src/telemetry.ts` contains a helper and event definitions but is not itself proof of an end-to-end deployment measurement. This issue requires real, timed validation against supported App/workflow execution before it can be closed.

## Acceptance criteria

- A fresh repository can install the reviewed workflow and starter configuration without provisioning a worker.
- A pull request produces a target-repository GitHub Actions run and a native BoardReadyOps Check Run.
- The workflow verifies the assigned commit SHA and uses GitHub OIDC rather than a shared callback secret.
- The first result links to the hosted dashboard and the target Actions run.
- The repository owner can move from warn to enforce mode deliberately.
- Private repositories consume the owner's Actions quota and keep source/logs/artifacts in their repository boundary.
- Missing workflow or permission states produce actionable setup guidance rather than a false successful result.
