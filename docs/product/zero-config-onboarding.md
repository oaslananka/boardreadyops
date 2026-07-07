# Zero-config onboarding flow

Issue: #16

## Goal

A user installing the GitHub App should get from installation to a useful first BoardReadyOps result without writing configuration first.

## First-result path

1. Install BoardReadyOps GitHub App.
2. Select repositories.
3. BoardReadyOps detects KiCad projects and supported release artifacts.
4. BoardReadyOps chooses a safe preset:
   - prototype for early hardware branches,
   - assembly-ready for manufacturing handoff branches,
   - production for release tags or protected branches.
5. BoardReadyOps creates a queued release readiness run.
6. The runner publishes signed results back to the hosted app.
7. The PR/check view links to the hosted run dashboard.
8. The dashboard shows decision, findings, and artifact availability.

## Required UX surfaces

- GitHub App install success page.
- Repository setup page.
- Policy preset selector.
- First run status page.
- PR check-run output.
- PR comment summary.
- Hosted run dashboard.

## Safe defaults

- Never block PRs on first install unless explicitly configured.
- Run in warn mode for first result.
- Do not expose private artifact downloads without signed URLs.
- Do not dispatch runners for repositories outside the rollout policy.
- Avoid fork PR write permissions unless safe mode allows it.

## Acceptance criteria

- A fresh repository can produce a first check run without a committed config.
- The first result links to a hosted dashboard.
- The user can see which preset was chosen and how to change it.
- The user can promote from warn to enforce mode deliberately.
- Private repositories and fork PRs have safe-mode behavior documented and enforced.
