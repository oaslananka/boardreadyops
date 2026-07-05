[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / RulePackManifest

# Interface: RulePackManifest

A rule pack: a named, versioned bundle of rule configuration presets.

Rule packs are not full plugins — they do not ship rule implementations.
Instead they layer on top of the built-in or plugin-contributed rule set
by enabling/disabling rules and setting configuration defaults suited to
a specific release context (prototype, production, open-hardware, etc.).

Rule packs can be distributed as npm packages or as local YAML files.
The host merges rule overrides in pack order (later entries win).

## Properties

### author?

> `optional` **author?**: `string`

Who authored or maintains this pack.

***

### compatibility?

> `optional` **compatibility?**: [`CompatibilityConstraints`](CompatibilityConstraints.md)

Compatibility constraints the host must check before loading.

***

### description

> **description**: `string`

One-line description shown in `boardreadyops doctor` output.

***

### homepage?

> `optional` **homepage?**: `string`

URL to the pack homepage, repository, or registry entry.

***

### id

> **id**: `string`

Unique reverse-DNS-style pack identifier.

***

### license?

> `optional` **license?**: `string`

SPDX license expression.

***

### name

> **name**: `string`

Human-readable display name.

***

### releaseMode?

> `optional` **releaseMode?**: `"prototype"` \| `"pilot"` \| `"production"`

Release mode to enforce when this pack is active.
Overrides the project-level releaseMode.

***

### rules?

> `optional` **rules?**: `Record`\<`string`, `boolean` \| [`RulePackRuleOverride`](RulePackRuleOverride.md)\>

Rule configuration overrides applied when the pack is active.

Keys are rule IDs (e.g. "bom.missing-mpn"). The value is a boolean
(true = enable, false = disable) or a RulePackRuleOverride object.

***

### tags?

> `optional` **tags?**: `string`[]

Category tags used for discovery in the marketplace or CLI.
Examples: "prototype", "production", "open-hardware", "automotive", "iec-62443"

***

### vendorProfile?

> `optional` **vendorProfile?**: `string`

Vendor profile ID to activate when this pack is used.
Must match a built-in or plugin-contributed vendor profile ID.

***

### version

> **version**: `string`

Semver version string.
