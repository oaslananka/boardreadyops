[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / SupplierIntelligenceResult

# Interface: SupplierIntelligenceResult

Result returned by a supplier intelligence provider.

## Properties

### queriedAt?

> `optional` **queriedAt?**: `string`

ISO 8601 timestamp when the query was executed.

***

### records

> **records**: `Map`\<`string`, [`SupplierIntelligenceRecord`](SupplierIntelligenceRecord.md)\>

Per-component records, keyed by MPN.

***

### warnings?

> `optional` **warnings?**: `string`[]

Provider-level warnings (e.g. API rate limit, partial data, freshness).
