[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / defineRulePack

# Function: defineRulePack()

> **defineRulePack**(`pack`): [`RulePackManifest`](../interfaces/RulePackManifest.md)

Returns a rule pack manifest with its public type checked at authoring time.

## Parameters

### pack

[`RulePackManifest`](../interfaces/RulePackManifest.md)

## Returns

[`RulePackManifest`](../interfaces/RulePackManifest.md)

## Example

```ts
import { defineRulePack } from "@boardreadyops/plugin-sdk";

export const prototypeReadyPack = defineRulePack({
  id: "com.example.prototype-ready",
  name: "Prototype Ready",
  version: "1.0.0",
  description: "Enables all checks required for a first-build prototype.",
  tags: ["prototype"],
  rules: {
    "bom.missing-mpn": true,
    "bom.lifecycle": { enabled: true, severity: "medium" },
    "manufacturing.package-completeness": false,
  },
});
```
