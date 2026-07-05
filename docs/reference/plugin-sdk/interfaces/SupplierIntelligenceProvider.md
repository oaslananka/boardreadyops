[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / SupplierIntelligenceProvider

# Interface: SupplierIntelligenceProvider

Supplier intelligence provider extension point for plugins.

## Properties

### id

> **id**: `string`

***

### name

> **name**: `string`

***

### requiresNetwork?

> `optional` **requiresNetwork?**: `boolean`

True when this provider requires network access.

## Methods

### query()

> **query**(`input`): `Promise`\<[`SupplierIntelligenceResult`](SupplierIntelligenceResult.md)\>

Fetch supplier intelligence for the given components.

#### Parameters

##### input

[`SupplierIntelligenceQuery`](SupplierIntelligenceQuery.md)

#### Returns

`Promise`\<[`SupplierIntelligenceResult`](SupplierIntelligenceResult.md)\>
