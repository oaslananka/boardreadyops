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

Checks that exported Gerber and drill artifacts match the current source revision and have an authentic export provenance manifest.

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
