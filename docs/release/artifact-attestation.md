# GitHub Artifact Attestation Integration

**Issue:** [#298](https://github.com/oaslananka/boardreadyops/issues/298)

> **Implementation boundary (2026-10-08):** This page documents a proposed / illustrative
> GitHub Artifact Attestation workflow, **not** a currently enforced manufacturing
> source-commit release gate. The current CLI can record an attestation URI as bundle
> metadata; recording a URI does not validate its signature, issuer, reviewed commit,
> or relation to a KiCad export. The examples below contain historical version/action
> references and are **not copy-paste-ready release instructions**.
> See [Source-to-Exported Artifact Proof — Design Contract](source-export-provenance-contract.md)
> and open issue [#771](https://github.com/oaslananka/boardreadyops/issues/771).

BoardReadyOps release evidence bundles can be enriched with GitHub Artifact Attestations to provide supply-chain-grade provenance for manufactured hardware.

---

## What is a GitHub Artifact Attestation?

GitHub Artifact Attestations (powered by Sigstore) cryptographically bind an artifact (e.g., a Gerber zip or evidence bundle) to the specific workflow run that produced it. The attestation is stored in the GitHub container registry and verifiable offline with `gh attestation verify`.

---

## Provenance Metadata in the Evidence Bundle

The `manifest.json` v2 schema includes a `provenance` field that records:

```json
{
  "provenance": {
    "source": "https://github.com/org/repo",
    "attestation": "https://github.com/org/repo/attestations/1234",
    "runId": "12345678",
    "runUrl": "https://github.com/org/repo/actions/runs/12345678",
    "toolchain": {
      "boardreadyops": "1.7.0",
      "kicad": "10.0.4"
    }
  }
}
```

Fields are populated from environment variables available in GitHub Actions:
- `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY` → `source`
- `GITHUB_RUN_ID` → `runId`, `runUrl`
- Attestation URL is added after the attestation is created

---

## Proposed Trusted Release Mode (not currently enforced)

A future trusted release policy should require *verified source-bound provenance* before calling manufacturing output fully trusted. The following proposed settings are **not an implemented enforcement contract**:

```yaml
# boardreadyops.yml
release:
  trusted: true          # require attestation for production releases
  require-attestation: true
```

**Target behavior only:** once that policy is implemented, missing or invalid independently verified provenance should prevent a source-bound release claim. The current release pipeline does **not** enforce `missing-attestation` as shown here.

Today an attestation URI is optional bundle metadata, and must not be mistaken for a verified signature or generation-from-reviewed-commit proof.

---

## Illustrative GitHub Actions Workflow (not a tested release recipe)

The following workflow generates Gerbers, runs BoardReadyOps, creates an evidence bundle, and attests both the bundle and the handoff zip.

```yaml
name: Hardware Release

on:
  push:
    tags: ["v*"]
  pull_request:

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write       # required for attestation (OIDC token)
      attestations: write   # required to store attestation
      pull-requests: write  # for PR comments

    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v4
        with:
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v4
        with:
          node-version: 22

      - name: Install BoardReadyOps
        run: npm install -g boardreadyops@1.7.0

      - name: Generate manufacturing artifacts
        run: boardreadyops generate . --profile jlcpcb --output build/fab

      - name: Run BoardReadyOps checks and prepare release
        run: |
          boardreadyops release prepare . \
            --profile jlcpcb \
            --output build/release \
            --provenance-source "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
            --provenance-run-id "$GITHUB_RUN_ID"

      - name: Create handoff package
        run: |
          boardreadyops handoff create build/release \
            --profile jlcpcb \
            --output build/handoff

      - name: Attest evidence bundle
        uses: actions/attest-build-provenance@a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32 # v2
        with:
          subject-path: build/release/
          subject-name: boardreadyops-evidence-bundle

      - name: Attest handoff zip
        uses: actions/attest-build-provenance@a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32 # v2
        id: attest-handoff
        with:
          subject-path: build/handoff.zip
          subject-name: boardreadyops-handoff-${{ github.ref_name }}

      - name: Record attestation in evidence bundle
        run: |
          node -e "
            const fs = require('fs');
            const manifest = JSON.parse(fs.readFileSync('build/release/manifest.json', 'utf8'));
            manifest.provenance = {
              ...manifest.provenance,
              attestation: '${{ steps.attest-handoff.outputs.bundle-path }}'
            };
            fs.writeFileSync('build/release/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
          "

      - name: Upload evidence bundle
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v4
        with:
          name: boardreadyops-release-${{ github.ref_name }}
          path: build/release/
          retention-days: 90

      - name: Upload handoff package
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v4
        with:
          name: boardreadyops-handoff-${{ github.ref_name }}
          path: build/handoff.zip
          retention-days: 90
```

---

## Required Permissions

| Permission | Required for |
|---|---|
| `id-token: write` | Obtaining the OIDC token used to sign the attestation |
| `attestations: write` | Storing the attestation in the GitHub container registry |
| `contents: read` | Checking out the repository |
| `pull-requests: write` | Posting PR comments (optional) |

---

## Verifying an Attestation

Anyone with read access to the repository can verify the attestation:

```bash
# Verify the evidence bundle attestation
gh attestation verify build/release/ \
  --repo org/repo \
  --predicate-type https://slsa.dev/provenance/v1

# Verify the handoff zip attestation
gh attestation verify build/handoff.zip \
  --repo org/repo
```

A **successful independent GitHub attestation verification** establishes the attested subject bytes and trusted workflow identity, when issuer/repository constraints are checked. It does **not**, by itself, prove the workflow generated Gerbers from the reviewed KiCad commit. That stronger relationship requires the same-run source/export binding described in the [design contract](source-export-provenance-contract.md). Merely placing a URL in `manifest.provenance.attestation` proves neither.

---

## Threat Model and Limitations

**What attestation protects against:**
- Artifact substitution (replacing a legitimate Gerber with a modified one)
- Proving which CI run produced a specific release package
- Detecting tampering after the fact

**What attestation does NOT protect against:**
- A compromised GitHub Actions runner that produces and attests incorrect Gerbers
- Mistakes or vulnerabilities in the KiCad schematic or PCB before generation
- Supply-chain risk in components listed in the BOM

**Limitations:**
- Attestations require GitHub Actions or a Sigstore-compatible OIDC provider. Self-hosted runners require additional configuration.
- The `actions/attest-build-provenance` action signs directory attestations by hashing all files; the specific file list is not embedded in the attestation predicate by default.
- Attestation URLs are ephemeral in some GitHub plans; verify availability for your plan before relying on verification in automation.

---

## See Also

- [Evidence Bundles](evidence-bundles.md)
- [Signed Release Manifests](https://github.com/oaslananka/boardreadyops/blob/main/src/release/signing.ts) — for Ed25519 manifest signing independent of GitHub
- [Policy Engine](policy-engine.md) — `require-attestation` policy rule
