# ADR-0006 - License Compliance

**Status:** Partially superseded by ADR-0019
**Date:** 2026-05-23

> Licensing choice for BoardReadyOps project-authored source is superseded by ADR-0019. Third-party separation and notice requirements documented here remain relevant.

## Context

BoardReadyOps is MIT licensed Node.js code that invokes `kicad-cli` as a
separate process. KiCad is GPL-licensed software, and the full container action
redistributes KiCad in the same image as BoardReadyOps for reproducible CI.

The project also needs a repeatable notice file for npm dependencies and a CI
gate that prevents incompatible licenses from entering the distributed runtime
dependency scope.

## Decision

BoardReadyOps keeps its own source code under MIT and treats KiCad as a separate
program invoked through command-line process boundaries. JSON, SARIF, Markdown,
HTML, JUnit, and workflow annotation reports are user/project output generated
from user PCB data and are not treated as derivative works of BoardReadyOps or
KiCad.

The full container image redistributes KiCad under GPL terms. The Docker image
preserves the GPL text at `/usr/share/doc/boardreadyops/LICENSE-KICAD` and keeps
the KiCad package notices under `/usr/share/doc/kicad/`.

`NOTICE` is generated from `pnpm licenses list --json` and committed. The
license policy gate checks the distributed dependency scope with this allowed
set:

- MIT
- ISC
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- MPL-2.0
- CC0-1.0

Development-only tooling licenses remain visible in `NOTICE`, but they are not
part of the distributed npm runtime dependency scope and are not gated by the
runtime allowlist.

## Consequences

- The npm package and GitHub Action continue to publish BoardReadyOps code under
  MIT.
- The container action must preserve KiCad GPL notices when redistributing
  KiCad.
- CI fails if a distributed npm dependency introduces a license outside the
  allowlist.
- Changes to dependency licenses require regenerating `NOTICE` and reviewing the
  runtime policy result.

## Alternatives Considered

- Treat the container image as MIT-only. Rejected because the image redistributes
  KiCad and must preserve KiCad's GPL terms.
- Gate every development dependency with the runtime allowlist. Rejected because
  development tools are not shipped in the npm package or container runtime, but
  their notices are still documented.
