---
id: firmware.zephyr-pin-contract
severity-default: high
applies-to:
  - firmware
  - pinmap
config-keys:
  - firmware.zephyr.pinAssignments
  - projects.firmware.zephyr.pinAssignments
  - rules.firmware.zephyr-pin-contract.file
---

# firmware.zephyr-pin-contract

## What It Checks

Checks a Zephyr firmware pin contract YAML against BoardReadyOps pinmap firmware labels.

## When It Fires

Fires when firmware assigns a signal to the wrong hardware pin/net, adds a signal not in hardware, or omits a hardware firmware signal.

## Configuration Example

```yaml
version: 1
rules:
  firmware.zephyr-pin-contract:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ firmware, hardware, sources }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
