---
id: manufacturing.paste-coverage
severity-default: medium
applies-to:
  - pcb
config-keys:
  - rules.manufacturing.paste-coverage.enabled
---

# manufacturing.paste-coverage

## What It Checks

Checks that each side carrying surface-mount assembly in the Gerber package has a matching solder paste layer.

## When It Fires

Fires when a side carrying surface-mount assembly has no solder paste stencil layer for that side in the Gerber package. The side is decided from each non-DNP footprint's mount type: through-hole parts are soldered from the far side of the board and need no paste, while an unknown mount type is an absence of evidence and is reported as unproven rather than treated as through-hole. A missing layer blocks only when every Gerber file in the package declares its own TF.FileFunction and a footprint states an SMD mount type. When the package's layer identity comes from filenames, or a file in it cannot be identified at all, the finding is advisory: it reports confidence low, says the layer could not be established rather than that it is absent, and caps its severity at low so a configured severity cannot turn an inference about a filename into a failing gate. The override is visible rather than silent -- details.configuredSeverity holds the severity that was configured, details.severityCapped says whether it was lowered, and details.rationale names the unproven part.

## Configuration Example

```yaml
version: 1
rules:
  manufacturing.paste-coverage:
    enabled: true
    severity: medium
```

## JSON Finding Details Shape

```text
{ side, severity, configuredSeverity, severityCapped, blocking, rationale, smdFootprints, throughHoleFootprints, unknownMountTypeFootprints, smdReferences, unknownMountTypeReferences, pasteLayers, pasteLayerFiles, layerIdentity, unidentifiedFiles, assumedIdentityFiles }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
