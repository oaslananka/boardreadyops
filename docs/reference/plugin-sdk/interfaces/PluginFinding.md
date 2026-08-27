[**@boardreadyops/plugin-sdk API**](../README.md)

***

[@boardreadyops/plugin-sdk API](../README.md) / PluginFinding

# Interface: PluginFinding

A finding emitted by a plugin rule against a project resource.

## Properties

### confidence?

> `optional` **confidence?**: [`PluginConfidenceLevel`](../type-aliases/PluginConfidenceLevel.md)

***

### details?

> `optional` **details?**: `Record`\<`string`, `unknown`\>

***

### fingerprint?

> `optional` **fingerprint?**: `string`

***

### fix?

> `optional` **fix?**: [`PluginFixSuggestion`](PluginFixSuggestion.md)

***

### location?

> `optional` **location?**: `object`

#### boardCoordinates?

> `optional` **boardCoordinates?**: `object`

##### boardCoordinates.layer?

> `optional` **layer?**: `string`

##### boardCoordinates.units

> **units**: `"in"` \| `"mm"`

##### boardCoordinates.x

> **x**: `number`

##### boardCoordinates.y

> **y**: `number`

#### column?

> `optional` **column?**: `number`

#### line?

> `optional` **line?**: `number`

#### region?

> `optional` **region?**: `object`

##### region.endColumn?

> `optional` **endColumn?**: `number`

##### region.endLine

> **endLine**: `number`

##### region.startColumn?

> `optional` **startColumn?**: `number`

##### region.startLine

> **startLine**: `number`

***

### message

> **message**: `string`

***

### project?

> `optional` **project?**: `string`

***

### references?

> `optional` **references?**: `string`[]

***

### resource

> **resource**: `object`

#### kind

> **kind**: `"project"` \| `"bom"` \| `"schematic"` \| `"pcb"` \| `"pinmap"` \| `"manifest"`

#### path

> **path**: `string`

***

### ruleId

> **ruleId**: `string`

***

### severity

> **severity**: [`PluginSeverity`](../type-aliases/PluginSeverity.md)

***

### suppressed?

> `optional` **suppressed?**: `boolean`
