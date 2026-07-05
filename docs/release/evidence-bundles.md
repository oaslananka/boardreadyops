# Release Evidence Bundles

`boardreadyops release pack [path]` creates a directory that captures the evidence needed to review a hardware release. The bundle is intentionally directory-based in this first version so CI jobs can publish it as an artifact without requiring an archive dependency.

```bash
boardreadyops release pack . --output build/boardreadyops-release
boardreadyops release verify build/boardreadyops-release
```

The pack command runs the normal BoardReadyOps pipeline, writes JSON and Markdown reports, copies discovered manufacturing artifacts from conventional output directories such as `fab/`, `fabrication/`, `manufacturing/`, `gerbers/`, and `production/`, and records every artifact in `manifest.json` with its SHA-256 digest and byte size. A companion `checksums.txt` file in GNU `sha256sum` format is also written for toolchain-agnostic verification.

## Bundle layout

The bundle uses a stable directory layout so reviewers and CI jobs always know where each class of file lives:

```text
build/boardreadyops-release/
├── manifest.json                # structured release record (schema version 2)
├── checksums.txt                # SHA-256 checksums in GNU sha256sum format
├── reports/                     # JSON and Markdown validation reports
│   ├── boardreadyops-report.json
│   └── boardreadyops-report.md
├── artifacts/                   # copied manufacturing outputs (Gerber, drill, BOM, CPL, …)
└── generated/                   # first-party generated outputs (see --include-generated)
```

The `manifest.layout` field records these directory names so downstream tools do not need to hard-code them.

## Manifest (schema version 2)

The manifest is a structured JSON release record with these top-level fields:

- `schemaVersion`: `2`
- `tool`: the BoardReadyOps name and version
- `generatedAt`: ISO 8601 generation time
- `git`: the Git SHA and dirty-worktree state when the project is inside a Git repository
- `decision`: the release-readiness `status` (`pass` or `fail`) plus human-readable `reasons`. The status mirrors the pipeline fail-on policy; reasons also surface evidence gaps that need review.
- `summary`: the pipeline finding summary
- `projects`: the discovered projects
- `layout`: the bundle directory names (`reports`, `artifacts`, `generated`)
- `artifacts`: every included file with its bundle-relative `path`, original `sourcePath` (for copied files), `kind`, `sha256` digest, and `bytes`
- `gaps`: evidence gaps for missing board/schematic files or missing manufacturing outputs
- `provenance`: optional provenance source and attestation URIs
- `verification`: the digest `algorithm` (`sha256`) and the `artifactCount` covered by checksums

Artifact `kind` is one of `report`, `fabrication`, `bom`, `cpl`, `drill`, `gerber`, `generated`, or `other`.

## Including generated outputs

Pass `--include-generated <dir>` to copy first-party generated outputs (for example the directory produced by `boardreadyops generate` or the `outputs/` directory from `boardreadyops release prepare`) into the bundle's `generated/` directory. Each copied file is recorded as an artifact with `kind: "generated"` and checksummed like every other file.

```bash
boardreadyops generate . --output build/outputs
boardreadyops release pack . --output build/boardreadyops-release --include-generated build/outputs
```

A generated directory that resolves inside the bundle output directory is skipped (the output directory is rewritten on each run).

Use provenance flags when a CI release job has external attestations or release assets that should be linked from the manifest:

```bash
boardreadyops release pack . \
  --output build/boardreadyops-release \
  --provenance-source github://oaslananka/boardreadyops/actions/runs/123 \
  --provenance-attestation https://github.com/oaslananka/boardreadyops/attestations/123
```

`boardreadyops release verify [bundle]` reads `manifest.json` and recomputes every artifact digest. It exits with code `0` when all listed artifacts match, and code `1` when an artifact is missing, changed, truncated, or points outside the bundle directory.

```bash
boardreadyops release verify build/boardreadyops-release
boardreadyops release verify build/boardreadyops-release --format json
```

A non-empty `gaps` list does not make verification fail. Gaps are explicit review evidence: they explain what was not present in the release package so a maintainer can block the release, add the missing output, or document a waiver in the normal release process.

## Checksums file

Every bundle also includes a `checksums.txt` file in GNU `sha256sum(1)` format:

```
a3f2...  artifacts/fab/board.GTL
d9c1...  artifacts/fab/board.drl
...
```

This allows independent verification without boardreadyops tooling:

```bash
cd build/boardreadyops-release
sha256sum --check checksums.txt
```

The `checksums.txt` covers exactly the same files as `manifest.json`. The manifest is the authoritative source; `checksums.txt` is a convenience format for toolchains that consume standard checksum files.

## Manifest coverage

The manifest records every file that boardreadyops wrote into the bundle. If a post-processing step adds files to the bundle directory (for example an attestation tool that appends files), the `release verify` command's coverage check will flag them as uncovered.

Uncovered files do not block `release verify` by default — coverage gaps are surfaced in the JSON output so automation can decide whether to treat them as blocking. Use `--strict-coverage` (when available) to make uncovered files a hard failure.

## Signing and provenance

`boardreadyops release sign [bundle] --key <private-key>` cryptographically signs the bundle. It signs the raw bytes of `manifest.json` with an Ed25519 private key and writes a `manifest.sig` sidecar containing the algorithm (`ed25519`), the manifest SHA-256 digest, the base64 signature, the signer's public key (SPKI PEM), and the signing time.

```bash
openssl genpkey -algorithm ed25519 -out release-signing.key
openssl pkey -in release-signing.key -pubout -out release-signing.pub

boardreadyops release sign build/boardreadyops-release --key release-signing.key
boardreadyops release verify build/boardreadyops-release --public-key release-signing.pub
```

### Trust model

The signature is a chained attestation, not a per-file signature:

1. `release sign` signs `manifest.json`.
2. `manifest.json` records the SHA-256 and byte size of every report, artifact, and generated output.
3. `release verify --public-key` re-checks each artifact digest against the manifest **and** verifies the manifest signature against the trusted public key.

A consumer who trusts the public key therefore transitively trusts every file the manifest lists. Tampering with any artifact breaks its digest; tampering with the manifest breaks the signature; substituting the signer's key is rejected because the embedded key is pinned to the `--public-key` you supply.

The private key is never read from or written to the bundle — keep it outside the repository (a CI secret, a KMS-exported key, or a hardware token export). Only the public key and `manifest.sig` are distributed with the release.

`release verify` exits non-zero when `--public-key` is supplied but the bundle is unsigned, when the signature does not match the manifest, or when the embedded key differs from the trusted key. Without `--public-key`, verification falls back to checksum-only and an unsigned bundle still passes.

### CI workflow example

```yaml
# .github/workflows/release-sign.yml
jobs:
  sign-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - run: npx boardreadyops release pack . --output build/boardreadyops-release
      - run: |
          printf '%s' "$RELEASE_SIGNING_KEY" > release-signing.key
          npx boardreadyops release sign build/boardreadyops-release --key release-signing.key
          rm -f release-signing.key
        env:
          RELEASE_SIGNING_KEY: ${{ secrets.RELEASE_SIGNING_KEY }}
      - run: npx boardreadyops release verify build/boardreadyops-release --public-key release-signing.pub
```
