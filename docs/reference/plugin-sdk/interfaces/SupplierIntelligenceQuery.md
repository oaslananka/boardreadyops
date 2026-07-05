[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / SupplierIntelligenceQuery

# Interface: SupplierIntelligenceQuery

Input passed to a supplier intelligence provider when querying component data.

## Properties

### components

> **components**: `object`[]

Components to look up; each entry has at minimum a reference and optionally mpn/manufacturer.

#### manufacturer?

> `optional` **manufacturer?**: `string`

#### mpn?

> `optional` **mpn?**: `string`

#### reference

> **reference**: `string`

***

### projectRoot?

> `optional` **projectRoot?**: `string`

Optional project root path (read-only access).
