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

On same-repository pull requests that execute CodeQL, the `security / codeql` job now
also verifies the **native GitHub Advanced Security `CodeQL` check-run** for the exact
pull-request head SHA. GitHub may report a failed code-scanning alert check even
when the CodeQL analysis and SARIF upload completed successfully. A failed,
missing, cancelled, or still-pending native result therefore fails the CodeQL
job, which the existing required `security / gate` already depends upon. This
uses read-only `checks` permission and a bounded wait, with no separate required
check or duplicate scanner. The policy still skips CodeQL for documentation-only
changes and fork pull requests, whose untrusted code cannot publish SARIF using
the repository token; the existing post-merge scan remains authoritative there.

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

## KiCad 10 real-integration reliability

The Node 24 / PostgreSQL 17 manufacturing lane always executes genuine KiCad
10.0.x integration tests when the risk classifier requires KiCad. Its primary
install path is the project-maintained **signed** Ubuntu PPA with APT's
signature, candidate-version and package-hash checks enabled. If and only if
that KiCad PPA fails from an explicit transient 5xx or connectivity error,
`scripts/install-kicad-ci.sh` uses the official KiCad CLI image from the
public KiCad GitHub Container Registry pinned to a reviewed, immutable SHA-256
digest. Signature or integrity verification failures, wrong KiCad versions,
unexpected OCI vendor metadata and unrelated package-index errors still fail
the CI job; no other test lane is skipped or deemed successful.

The OCI CLI runs non-root with networking disabled, a read-only root filesystem,
no added capabilities, an ephemeral runtime home and limited temporary and
checkout-directory mounts. This is a **different trusted distribution channel**:
OCI digest pinning verifies exact image bytes but must not be misrepresented as
an APT GPG signature or a separately signed upstream attestation. Image digest
updates require deliberate supply-chain review, not an automatic floating tag.
The public GHCR image requires no custom image publishing, VPS capacity,
additional runner, paid cache, or permanent binary in Git; the tradeoff is a
large image pull if the PPA is unavailable. The regular required check names and
real KiCad release gates are unchanged.

## Updating the policy

When adding a new source area, update `scripts/ci-risk-profile.mjs` and add a unit test in `tests/unit/scripts/ci-risk-profile.test.ts`. If the new area should block merges, also update `scripts/setup-branch-protection.sh`.
