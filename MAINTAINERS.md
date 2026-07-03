# Maintainers

BoardReadyOps is currently maintained by a single project owner.

| Role | GitHub handle | Responsibilities |
| --- | --- | --- |
| Project maintainer | `@oaslananka` | Roadmap, releases, package ownership, repository settings, security triage, and final merge decisions. |

## Current governance status

- Maintainer model: single maintainer.
- Independent regular reviewers: not yet established.
- Human review: expected for public contract, release, governance, and security
  changes, but not yet sufficient for a Gold/foundation-grade claim.
- CODEOWNERS: `.github/CODEOWNERS` assigns ownership to `@oaslananka`.
- Branch protection: enabled on `main` as of the 2026-07-02 audit, with one
  required approval and CODEOWNERS review; required status checks still need
  maintainer confirmation/enforcement.

## Adding maintainers

A new maintainer should demonstrate sustained contribution across code, tests,
documentation, and review. The maintainer should be able to review pull requests
independently, handle releases safely, and follow the security disclosure process.

Candidate criteria:

1. Multiple meaningful merged contributions.
2. Demonstrated understanding of the release pipeline and evidence bundle model.
3. Consistent review quality on pull requests.
4. No unresolved conflict-of-interest or security concerns.
5. Agreement to follow `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `GOVERNANCE.md`.

Maintainer additions or removals should be recorded in this file and referenced
from the related pull request.
