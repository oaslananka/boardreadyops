# Hardware SBOM

BoardReadyOps emits a hardware SBOM for KiCad projects with:

```bash
boardreadyops sbom . --output build/hbom.json
```

The output is CycloneDX 1.7 JSON with `bomFormat: "CycloneDX"` and a top-level hardware device component. CycloneDX 1.7 uses `device` as the valid component type for hardware, so BoardReadyOps emits `metadata.component.type: "device"` and adds `metadata.properties[]` entry `boardreadyops:componentClass=hardware` to preserve the hardware classification without producing invalid CycloneDX.

Each fabrication BOM row becomes a `components[]` item with:

- `type: "device"`
- `name` from MPN, value, or reference, in that order
- `version` from the KiCad value when available
- `manufacturer` and `supplier` when the BOM row includes them
- `purl` as `pkg:generic/<manufacturer>/<mpn>` when both manufacturer and MPN are available
- `externalReferences[]` for supplier URLs
- `properties[]` for `kicad:reference`, `kicad:footprint`, `kicad:dnp`, `boardreadyops:mpn`, `boardreadyops:sourcePath`, `boardreadyops:lifecycle`, `boardreadyops:compliance`, `boardreadyops:quantity`, and repeated `boardreadyops:supplier` values

When a BOM provides RoHS/REACH columns, `boardreadyops:compliance` carries the normalized value, and the opt-in `bom.compliance` rule flags populated components that are non-compliant (or, with `require`, missing compliance data). New supplier or compliance data sources extend the BOM through the column aliases in `src/bom/normalizer.ts` — the documented extension point for future supplier integrations.

`schemas/hbom.schema.json` is the repository contract for the emitted HBOM shape. It follows the CycloneDX 1.7 component model and keeps BoardReadyOps-specific hardware fields in CycloneDX properties.

## CLI

```bash
boardreadyops sbom .
boardreadyops sbom . --output build/hbom.json
boardreadyops sbom . --output -
boardreadyops schema hbom
```

`--output` defaults to `build/hbom.json`. `--output -` writes only the HBOM JSON to stdout. `--format cyclonedx` is the implemented format; `--format spdx` is reserved for a future release and fails fast so automation does not mistake it for implemented SPDX output.

## GitHub Action

Set the `hbom` input to write the hardware SBOM during an Action run. The empty default disables HBOM generation.

```yaml
- uses: oaslananka/boardreadyops@9bc8a075d885ad1182e2ad4fcd4c9160f8160c94 # v1.31.2
  with:
    config: boardreadyops.yml
    hbom: build/hbom.json
```

The Action sets `hbom-path` to the absolute path when the file is produced. If `upload-artifacts` is enabled, the HBOM is included with the other BoardReadyOps report artifacts.

## Signing And Attestation

Release publishing remains owned by maintainer release workflows. For release workflows that already create fabrication or binary artifacts, attach the HBOM as a release asset and create an SBOM attestation against the release artifact.

GitHub's current SBOM attestation action is `actions/attest`; `actions/attest-sbom` is deprecated as a wrapper. The current `actions/attest` v4 release runs on Node24 and supports `sbom-path`.

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write

steps:
  - run: boardreadyops sbom . --output build/hbom.json
  - name: Install cosign
    uses: sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.2
  - name: Sign hardware SBOM
    run: cosign sign-blob --yes --bundle build/hbom.sigstore.json build/hbom.json
  - name: Verify hardware SBOM signature
    run: |
      cosign verify-blob build/hbom.json \
        --bundle build/hbom.sigstore.json \
        --certificate-identity-regexp "^https://github.com/${{ github.repository }}/" \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com
  - name: Attest hardware SBOM
    uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26 # v4.1.0
    with:
      subject-path: build/fabrication.zip
      sbom-path: build/hbom.json
  - name: Attach hardware SBOM
    env:
      GH_TOKEN: ${{ github.token }}
    run: gh release upload "$GITHUB_REF_NAME" build/hbom.json build/hbom.sigstore.json --clobber
```

Use the actual release artifact as `subject-path`. For PCB manufacturing releases this is usually the fabrication package, Gerber archive, or signed binary bundle, not the HBOM itself.
