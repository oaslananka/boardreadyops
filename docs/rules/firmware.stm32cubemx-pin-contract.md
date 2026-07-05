---
id: firmware.stm32cubemx-pin-contract
severity-default: high
applies-to:
  - firmware
  - pinmap
config-keys:
  - firmware.stm32cubemx.project
  - projects.firmware.stm32cubemx.project
  - rules.firmware.stm32cubemx-pin-contract.file
  - rules.firmware.stm32cubemx-pin-contract.mcu-designator
---

# firmware.stm32cubemx-pin-contract

## What It Checks

Parses a STM32CubeMX `.ioc` project file and checks GPIO labels against BoardReadyOps pinmap firmware labels.

## When It Fires

Fires when GPIO labels disagree with the hardware pinmap, when extra labels exist, or when hardware firmware signals are missing from the .ioc file.

## Configuration Example

```yaml
version: 1
rules:
  firmware.stm32cubemx-pin-contract:
    enabled: true
    severity: high
```

## JSON Finding Details Shape

```text
{ firmware, hardware, sources }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
