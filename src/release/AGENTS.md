# Release Evidence Instructions

These instructions apply to `src/release/**` and supplement the repository root instructions.

This subsystem prepares, signs, verifies, diffs, and packages release evidence and manufacturer handoff artifacts. Treat changes here as release-integrity work.

## Evidence invariants

- Manifest signatures use the documented Ed25519 contract over the exact manifest bytes.
- SHA-256 digests and checksums must identify the bytes they claim to bind.
- Verification fails closed on unsupported algorithms, digest mismatch, invalid signatures, malformed signature files, or trusted-key mismatch.
- Do not downgrade failed cryptographic verification to a warning merely to continue a release.
- Do not silently rewrite signed evidence after signing.

## Bundle and handoff integrity

- Generated evidence and manifests remain deterministic and reviewable.
- Preserve path traversal, symlink, and archive safety for bundle and handoff operations.
- Do not infer manufacturer approval or guaranteed fabrication readiness from file presence alone.
- Public schema/manifest changes require compatibility tests and docs updates.
- Released artifacts are immutable; produce a new release instead of replacing bytes under an existing identity.

## Key handling

- Real signing credentials do not belong in repository files, logs, reports, fixtures, or generated documentation.
- Trust-store and key-rotation behavior must remain explicit and testable.

## Verification

Run focused release/signing/handoff tests plus build/dist/release verification when public release artifacts change.
