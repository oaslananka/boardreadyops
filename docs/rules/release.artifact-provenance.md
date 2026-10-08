---
id: release.artifact-provenance
severity-default: high
applies-to:
  - pcb
config-keys:
  - rules.release.artifact-provenance.enabled
  - rules.release.artifact-provenance.manifest-path
---

# release.artifact-provenance

## What It Checks

Checks self-reported source-file fingerprints and exported Gerber/drill artifact hashes; this does not authenticate a reviewed commit or export runner.

## When It Fires

Fires when exported manufacturing artifacts in the repository lack a valid provenance manifest or when source files have been modified since the exports were generated.

## Configuration Example

```yaml
version: 1
rules:
  release.artifact-provenance:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ status, reasons, sourceFingerprintMatch, artifactMismatches }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
