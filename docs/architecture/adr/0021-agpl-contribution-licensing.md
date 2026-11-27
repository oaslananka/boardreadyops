# ADR-0021 - AGPL and contribution licensing

**Status:** Accepted
**Date:** 2026-11-15
**Decision evidence:** [PR #1565](https://github.com/oaslananka/boardreadyops/pull/1565)
**Supersedes:** [ADR-0019](0019-source-available-commercial-licensing.md)

## Context

ADR-0019 recorded the September 2026 move from MIT to PolyForm Noncommercial.
PR #1565 subsequently adopted AGPL-3.0-only for current project-authored source
and removed separate contributor agreement requirements. This record documents
that already-merged decision; it does not change the license.

## Decision

- Current project-authored source is licensed under
  [GNU AGPL v3.0 (AGPL-3.0-only)](https://github.com/oaslananka/boardreadyops/blob/main/LICENSE).
  Commercial use is permitted under its terms.
- Contributions use ordinary GitHub pull requests. No CLA, DCO sign-off,
  or copyright assignment is required; contributors retain copyright and
  must have rights to submit their work under AGPL-3.0-only.
- Previously published revisions and artifacts retain their original
  license terms. Third-party material retains applicable notices and licenses.

## Consequences

Current package and distribution metadata must reflect the current project
license; historical releases must not be represented as retroactively
relicensed. See [LICENSING.md](https://github.com/oaslananka/boardreadyops/blob/main/LICENSING.md)
and [CONTRIBUTOR-LICENSING.md](https://github.com/oaslananka/boardreadyops/blob/main/CONTRIBUTOR-LICENSING.md)
for the current policy and [ADR-0006](0006-license-compliance.md) for
third-party license separation.
