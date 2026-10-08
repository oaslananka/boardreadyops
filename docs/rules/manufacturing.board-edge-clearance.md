---
id: manufacturing.board-edge-clearance
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.board-edge-clearance.enabled
  - rules.manufacturing.board-edge-clearance.min-clearance-mm
---

# manufacturing.board-edge-clearance

## What It Checks

Checks that copper features in the Gerber package maintain the required minimum clearance from the board edge.

## When It Fires

Reports copper traces, flashed pads, and filled regions that violate board-edge clearance. A blocking result requires a declared board outline and copper layer, complete modeled geometry, and an explicit or assured vendor clearance limit. Missing/open outlines, unsupported arcs/macros, unknown copper extents, or unverified vendor-limit provenance produce non-blocking advisory findings.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.board-edge-clearance:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ minClearanceMm, limitSource, blocking, blockingRationale, configuredSeverity, severityCapped, geometryConfidence, profileAssurance, profileMayBlock, outlineRoleEvidence }
Measured: { measuredClearanceMm, layerRoleEvidence, featureKind, featureLocation, apertureCode, featureExtentEvidence, geometryUncertainty, profileRevision, profileSource, verifiedAt }
Incomplete geometry: { measuredClearanceMm: number | null, geometryUncertainty }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
