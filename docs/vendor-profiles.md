# Vendor Profiles

Vendor profiles let BoardReadyOps turn a generic output check into a manufacturer-oriented release gate. A profile does not replace the manufacturer's live quoting rules; it records the release evidence BoardReadyOps expects before a package is considered ready for that vendor workflow.

## Generic preset profiles

Use these when you do not have a named vendor selected yet, or when you want to gate releases by readiness stage:

| Profile | Service | Required evidence | Use case |
| --- | --- | --- | --- |
| `generic-prototype` | fabrication | Gerbers, drill files | Fast prototype spins; BOM and PDF are recommended |
| `generic-assembly-ready` | fabrication + assembly | Gerbers, drill, BOM, position/CPL | Assembly handoff; STEP and PDF recommended |
| `generic-production` | fabrication + assembly | Gerbers, drill, BOM, position/CPL, STEP, PDF | Production release gate |

## Named vendor profiles

| Profile | Service | Required evidence |
| --- | --- | --- |
| `jlcpcb` | fabrication + assembly | Gerbers, drill files, BOM, position/CPL |
| `pcbway` | fabrication + assembly | Gerbers, drill files, BOM, position/CPL, PDF documentation |
| `oshpark` | fabrication | Gerbers, drill files |
| `aisler` | fabrication + assembly | Gerbers, drill files, BOM, position/CPL |
| `seeed-fusion` | fabrication + assembly | Gerbers, drill files, BOM, position/CPL |
| `eurocircuits` | fabrication | Gerbers, drill files, PDF documentation |

Use the CLI to inspect the available profiles:

```sh
boardreadyops vendor list
boardreadyops vendor explain generic-prototype
boardreadyops vendor explain jlcpcb
boardreadyops vendor explain pcbway --format json
```

## Configuration

Configure a profile in `boardreadyops.yml`:

```yaml
version: 1
vendor:
  profile: jlcpcb
  service: fabrication+assembly
```

`service` can narrow requirements when the profile supports more than one workflow:

```yaml
version: 1
vendor:
  profile: jlcpcb
  service: fabrication
```

Add project-specific required artifacts with `required`. These are merged with the selected profile's requirements:

```yaml
version: 1
vendor:
  profile: pcbway
  required:
    - step
```

## Profile inheritance

Every named vendor profile can be extended with per-project overrides:

```yaml
version: 1
vendor:
  profile: generic-assembly-ready
  required:
    - step          # promote STEP from recommended to required for this project
  board:
    layers: [4]     # document expected layer count
  assembly:
    requiresFiducials: true
```

Overrides are merged on top of the base profile — they never remove a requirement.

## Readiness scoring

The selected profile feeds both `manufacturing.outputs-present` and the [release readiness score](release/readiness-scoring.md). Profiles classify evidence as required or recommended; required outputs block readiness when missing, while recommended outputs (such as a fabrication PDF or STEP model) lower the score without blocking. Findings include the profile id and any relevant assumptions so reviewers can see why an output is required.

```yaml
version: 1
vendor:
  profile: oshpark
rules:
  manufacturing.outputs-present:
    enabled: true
```

Treat built-in profiles as conservative evidence gates. Always verify the current vendor capabilities, stackup rules, assembly constraints, and quote-specific requirements before placing an order.
