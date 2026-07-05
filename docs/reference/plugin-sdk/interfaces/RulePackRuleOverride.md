[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / RulePackRuleOverride

# Interface: RulePackRuleOverride

Per-rule configuration override declared inside a rule pack.

Consumers can enable/disable rules, override severity, and set config keys
without writing their own boardreadyops.yml rule overrides.

## Indexable

> \[`configKey`: `string`\]: `unknown`

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

***

### severity?

> `optional` **severity?**: `"critical"` \| `"high"` \| `"medium"` \| `"low"` \| `"info"`
