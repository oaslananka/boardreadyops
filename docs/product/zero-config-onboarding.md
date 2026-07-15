# Guided GitHub App onboarding flow

Issue: #16

## Goal

A repository owner should move from GitHub App installation to a useful first BoardReadyOps result with a small, reviewable setup surface and without provisioning a KiCad worker or a long-lived callback secret.

The target-repository GitHub Actions decision intentionally requires two committed files:

```text
.github/workflows/readiness-runner.yml
boardreadyops.yml
```

This is not zero-file onboarding. The workflow requirement is the least-privilege alternative to granting the GitHub App Contents write access.

## First-result path

1. Install the BoardReadyOps GitHub App.
2. Select repositories.
3. Add the reviewed readiness workflow and starter configuration to each target repository default branch.
4. BoardReadyOps records the installation and repository.
5. A supported pull request event creates a queued release-readiness run and native Check Run.
6. The App dispatches the target repository's workflow.
7. GitHub Actions checks out the exact commit, installs KiCad, and runs BoardReadyOps.
8. The workflow sends normalized results through a run/attempt-bound GitHub OIDC callback.
9. The Check Run and hosted dashboard show the decision, findings, and GitHub Actions run link.

## Required UX surfaces

- GitHub App install success page.
- Repository setup page with copyable workflow and starter configuration.
- Detection of missing workflow, disabled Actions, and missing App Actions permission.
- First run status page.
- PR Check Run output.
- Hosted run dashboard.

## Safe defaults

- Do not grant the App Contents write to install files automatically.
- Do not store a BoardReadyOps callback API key in target repositories.
- Do not dispatch draft or fork pull requests in the initial hosted profile.
- Keep source, logs, and workflow artifacts in the target repository.
- Use exact-SHA action pins and exact-SHA checkout verification.
- Use warn-mode starter policy unless the repository owner explicitly selects enforce mode.
- Do not dispatch repositories outside the installation selection and rollout policy.

## Acceptance criteria

- A fresh repository can install the reviewed workflow and starter configuration without provisioning a worker.
- A pull request produces a target-repository GitHub Actions run and a native BoardReadyOps Check Run.
- The workflow verifies the assigned commit SHA and uses GitHub OIDC rather than a shared callback secret.
- The first result links to the hosted dashboard and the target Actions run.
- The repository owner can move from warn to enforce mode deliberately.
- Private repositories consume the owner's Actions quota and keep source/logs/artifacts in their repository boundary.
- Missing workflow or permission states produce actionable setup guidance rather than a false successful result.
