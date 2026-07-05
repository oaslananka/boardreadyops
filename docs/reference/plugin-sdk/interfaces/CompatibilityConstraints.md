[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / CompatibilityConstraints

# Interface: CompatibilityConstraints

Compatibility constraint declared by a plugin or rule pack.

Used to ensure that packs are only loaded by compatible BoardReadyOps host
versions and against compatible KiCad projects.

## Properties

### boardreadyopsMax?

> `optional` **boardreadyopsMax?**: `string`

Maximum BoardReadyOps semver (exclusive), e.g. "3.0.0".

***

### boardreadyopsMin?

> `optional` **boardreadyopsMin?**: `string`

Minimum BoardReadyOps semver (inclusive), e.g. "1.8.0".

***

### kicadVersions?

> `optional` **kicadVersions?**: (`"9"` \| `"10"` \| `"future"`)[]

KiCad major versions that this pack supports.
