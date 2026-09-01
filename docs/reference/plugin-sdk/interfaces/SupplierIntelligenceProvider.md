[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / SupplierIntelligenceProvider

# Interface: SupplierIntelligenceProvider

**`Experimental`**

Supplier intelligence provider extension point for plugins.
  - Experimental supplier intelligence provider hook.

## Properties

### id

> **id**: `string`

**`Experimental`**

***

### name

> **name**: `string`

**`Experimental`**

***

### requiresNetwork?

> `optional` **requiresNetwork?**: `boolean`

**`Experimental`**

True when this provider requires network access.

## Methods

### query()

> **query**(`input`): `Promise`\<[`SupplierIntelligenceResult`](SupplierIntelligenceResult.md)\>

**`Experimental`**

Fetch supplier intelligence for the given components.

#### Parameters

##### input

[`SupplierIntelligenceQuery`](SupplierIntelligenceQuery.md)

#### Returns

`Promise`\<[`SupplierIntelligenceResult`](SupplierIntelligenceResult.md)\>
