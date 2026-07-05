[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / SupplierIntelligenceRecord

# Interface: SupplierIntelligenceRecord

Per-component intelligence record returned by a supplier provider.

## Properties

### alternates?

> `optional` **alternates?**: `string`[]

Approved or known alternate MPNs that can substitute this part.

***

### available?

> `optional` **available?**: `boolean`

Whether the part is currently available (sufficient stock for the project).

***

### complianceNotes?

> `optional` **complianceNotes?**: `string`[]

Compliance notes (e.g. RoHS, REACH, ECCN).

***

### fetchedAt?

> `optional` **fetchedAt?**: `string`

ISO 8601 timestamp when this record was last fetched or updated.

***

### leadTimeWeeks?

> `optional` **leadTimeWeeks?**: `number`

Indicative lead time in weeks at query time.

***

### lifecycleStatus?

> `optional` **lifecycleStatus?**: [`SupplierLifecycleStatus`](../type-aliases/SupplierLifecycleStatus.md)

Part lifecycle status from the supplier or distributor.

***

### manufacturer?

> `optional` **manufacturer?**: `string`

Manufacturer name, if known.

***

### mpn

> **mpn**: `string`

The MPN this record covers.

***

### notes?

> `optional` **notes?**: `string`

Free-form notes from the provider.

***

### restrictedSubstances?

> `optional` **restrictedSubstances?**: `boolean`

Whether the part is on any regulatory restricted substances list.

***

### supplierCount?

> `optional` **supplierCount?**: `number`

Number of known active distributors stocking this part.

***

### trust?

> `optional` **trust?**: [`SupplierDataTrust`](../type-aliases/SupplierDataTrust.md)

Trust level of the data in this record.
