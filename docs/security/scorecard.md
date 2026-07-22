# OpenSSF Scorecard

BoardReadyOps runs an OpenSSF Scorecard baseline on every `main` push, weekly,
and on manual dispatch. The baseline uses the pinned Scorecard CLI container
`ghcr.io/ossf/scorecard:v5.5.0@sha256:3f24714e9366917adb7a05635382c97dfecb14b21eaef3dfa2ea48c8e23e0795`
with the check selection that is enforceable for stable releases and without
human-review gating:

- `Dangerous-Workflow`
- `Dependency-Update-Tool`
- `Fuzzing`
- `License`
- `Pinned-Dependencies`
- `SAST`
- `Security-Policy`
- `Token-Permissions`
- `Vulnerabilities`

The workflow fails when the baseline aggregate score or any enforced check score
is below `9.0`.
Branch protection is verified separately with `scripts/setup-branch-protection.sh`
and the repository rulesets API because the default workflow token cannot inspect
the administrator-managed ruleset configuration in Scorecard.

## Notes For Enforced Checks

- `Binary-Artifacts`: this check remains enforced. Current Scorecard runs score
  it as passing because the committed `dist/action/index.cjs` and
  `dist/cli/index.cjs` files are generated JavaScript bundles, not binary
  artifacts. ADR-0002 records why the action bundles are committed, and
  `task verify:dist` prevents bundle drift.
- `Fuzzing`: this check remains enforced because current Scorecard runs score it
  as passing. BoardReadyOps does not claim an OSS-Fuzz or ClusterFuzz
  registration. If Scorecard behavior changes and this
  probe no longer passes, the workflow should fail until the repository either
  adds a recognized fuzzing integration or records a deliberate exception in an
  ADR.

## Deferred Full-Scan Checks

- `Branch-Protection`: verified by `scripts/setup-branch-protection.sh` and the
  repository rulesets API outside Scorecard because the default workflow token
  cannot inspect the administrator-managed ruleset configuration.
- `Packaging`: npm publication is triggered from clean `main` when a release tag and GitHub Release are published.
- `Signed-Releases`: npm provenance and GitHub artifact attestations are handled by the release workflows.
- `CII-Best-Practices`: external self-certification is not completed by the build agent. The badge can be added after the operator completes the questionnaire.
- `Code-Review`: the expected branch protection baseline requires pull requests, but the repository uses bot-only review and zero required human approvals by policy.
- `Contributors`: the repository starts with a single maintainer.
- `Maintained`: GitHub reports newly created repositories as young for the first 90 days.

## Accepted Findings

These findings are accepted outside the enforced Scorecard baseline. The owner
is the BoardReadyOps maintainer.

| Finding | Current decision | Revisit trigger |
| --- | --- | --- |
| `Branch-Protection` | Out of scope by maintainer decision for BOARD-56. The setup script remains the documented enforcement path. | Maintainer enables branch protection or changes the release gate policy. |
| `Binary-Artifacts` | Accepted because `dist/` contains the committed GitHub Action and CLI bundles that are part of the public release surface and are checked by `corepack pnpm run verify:dist`. | The project stops committing action bundles or the release process moves to generated artifacts only. |
| `Code-Review` | Accepted because the repository currently uses maintainer-operated bot PRs and zero required human approvals. | A second maintainer is added or required-review policy changes. |
| `CI-Tests` | Accepted as time-bound while the repository history ages into the current CI policy; current PR and main workflows run the full local gate including unit, integration, action, build, docs, security, and mutation checks. | Scorecard still reports fewer than 30/30 merged PRs with CI after 30 new CI-gated merges from this policy. |
| `CII-Best-Practices` | Accepted until the operator completes the external OpenSSF Best Practices questionnaire. | Stable release readiness review or maintainer completes the questionnaire. |
| `Maintained` | Accepted as time-bound because GitHub reports repositories created within the first 90 days as young. | Repository age exceeds 90 days and Scorecard still reports the finding. |
| `SAST` recent-commit coverage | Accepted as time-bound while the recent-commit window catches up to the current CodeQL and Scorecard workflows. | Scorecard still reports incomplete SAST coverage after 30 new commits with CodeQL checks. |
| release workflow `contents: write` | Accepted where required to create release PRs, upload release assets, or update floating release tags. Publishing and tag-moving are isolated from npm provenance publishing where practical. | GitHub provides narrower release/tag permissions or the release process stops moving floating tags. |
| self-smoke `security-events: write` | Accepted only for the SARIF upload smoke job. GitHub requires `security-events: write` to upload SARIF. | The SARIF upload path moves to a dedicated nightly/manual workflow or GitHub provides a narrower permission. |

## Required Follow-Up

After each stable release, rerun the full default Scorecard scan and review the omitted checks. High-severity findings from the enforced baseline are blocking defects.
