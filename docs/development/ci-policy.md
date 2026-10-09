# CI policy

BoardReadyOps uses risk-based CI so pull requests get the checks that match the files they changed without weakening the release gate.

The `ci` workflow always starts with `ci / risk-profile`. That job lists changed files and emits boolean outputs for downstream jobs. Required jobs are not disabled with workflow-level path filters because GitHub can leave required checks pending when an entire workflow is skipped by branch or path filtering.

## Required merge gate

The effective `main-standard` ruleset requires exactly these nine contexts:

- `ci / risk-profile`
- `ci / lint`
- `ci / typecheck`
- `ci / test-unit`
- `ci / build`
- `ci / verify-dist`
- `ci / coverage-gate`
- `SonarCloud Code Analysis`
- `security / gate`

Every repository-owned required CI job executes on each PR. For a low-risk changed-file
classification, its first step checks that classification succeeded and explicitly
records that the heavyweight test is not applicable. It must never be job-skipped:
GitHub accepts `skipped` jobs as passing required checks, which hides whether the
policy was actually evaluated. Invalid/missing classifier output is a failure.
All heavyweight validation still runs when the relevant risk-profile flag is true.

## Pull request routing

| Change type | CI behavior |
| --- | --- |
| Documentation only | Lint and docs build run. Required unit, typecheck, build, dist and coverage checks execute their lightweight applicability verification without expensive suites; non-required mutation, package and specialist security jobs are skipped. |
| Runtime or CLI code | Lint, typecheck, unit tests, build, dist verification and security gates run. |
| KiCad parser/model or rule code | Coverage and mutation gates also run. |
| Dependency, workflow or path-sensitive changes | The full OS/Node unit matrix and cross-platform path checks run. |
| Action or bundled distribution changes | Action smoke and dist checks run. |
| Report/docs UI changes | Docs build and accessibility checks run. |

## Heavy checks

Full mutation testing is no longer the default for every pull request. The `ci / mutation` job runs on explicit workflow dispatch for mutation-sensitive changes; scheduled `mutation-nightly` provides the regular broader signal. This keeps feedback fast for low-risk pull requests while keeping a regular full mutation signal.

## Updating the policy

When adding a new source area, update `scripts/ci-risk-profile.mjs` and add a unit test in `tests/unit/scripts/ci-risk-profile.test.ts`. If the new area should block merges, also update `scripts/setup-branch-protection.sh`.
