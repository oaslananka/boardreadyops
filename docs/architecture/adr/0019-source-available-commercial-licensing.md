# ADR-0019 - Source-Available and Commercial Licensing

**Status:** Accepted
**Date:** 2026-09-14

## Context

BoardReadyOps was previously published under the MIT License. That maximized
reuse, including unrestricted commercial reuse, but did not require commercial
users to obtain a license from the project owner.

The project now wants to remain publicly inspectable, forkable, and available
for noncommercial use while reserving commercial use of new project-authored
source revisions for separately negotiated licensing.

Previously published MIT releases cannot be retroactively withdrawn. Third-party
components also retain their own licenses.

## Decision

Current project-authored source is licensed under PolyForm Noncommercial 1.0.0.
Commercial use requires a separate written commercial license. Earlier revisions
already published under MIT remain usable under their original MIT terms.

Third-party material is not relicensed. In particular, the full container keeps
KiCad and other bundled components under their applicable upstream terms.

## Consequences

- BoardReadyOps should be described as source-available, not OSI-approved open source.
- Package, citation, image, and REUSE metadata must identify the new project license.
- OpenSSF/FLOSS evidence from the MIT period is historical and must not be presented as a current license claim.
- Non-trivial external code contributions require a reviewed CLA before merge so commercial licensing remains possible.
- Dependency-license allowlists and third-party notices continue to describe third-party packages independently of the BoardReadyOps project license.

This ADR supersedes ADR-0006 only for the license chosen for BoardReadyOps' own
project-authored source. ADR-0006 remains relevant for the separation between
BoardReadyOps and separately licensed third-party software such as KiCad.
