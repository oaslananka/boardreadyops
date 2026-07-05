# Plugin SDK

BoardReadyOps plugins let teams add rules, adapters, vendor profiles, report formats, and notifiers without forking the core repository. Plugins are normal Node.js packages or local JavaScript files that export a `BoardReadyOpsPlugin` object.

The SDK package exists in this repository under `packages/plugin-sdk`. It is
used by the checked-in example through the pnpm workspace and is not published
as a standalone npm package yet; `npm view @boardreadyops/plugin-sdk` currently
returns 404. Use a local workspace or file dependency until a release publishes
that package.

```sh
corepack pnpm --filter boardreadyops-plugin-custom-rule install
```

Define the plugin with `definePlugin`:

```ts
import { definePlugin } from "@boardreadyops/plugin-sdk";

export default definePlugin({
  name: "boardreadyops-plugin-custom-rule",
  version: "1.0.0",
  rules: [
    {
      meta: {
        id: "plugin.hello-world",
        title: "Plugin hello world",
        description: "Demonstrates a third-party rule plugin.",
        rationale: "Plugin rules can run with the same project context as built-in rules.",
        defaultSeverity: "info",
        appliesTo: ["project"],
        configKeys: [],
        kicadVersions: ["9", "10", "future"],
        tags: ["plugin"],
      },
      async run(context) {
        return [
          {
            ruleId: "plugin.hello-world",
            severity: "info",
            message: "Hello from a BoardReadyOps plugin.",
            project: context.projects[0]?.projectFile,
            resource: { path: context.projects[0]?.projectFile ?? ".", kind: "project" },
            confidence: "definite",
          },
        ];
      },
    },
  ],
});
```

The same example is available in `examples/plugin-custom-rule/`.

The generated API reference for exported SDK types and extension points is
available in [Plugin SDK API](reference/plugin-sdk/README.md). Regenerate it
with `corepack pnpm run api:docs` after changing
`packages/plugin-sdk/src/index.ts`; `corepack pnpm run gc` fails when the
checked-in API reference is stale.

## Loading Plugins

Declare explicit plugins in `boardreadyops.yml`:

```yaml
version: 1
plugins:
  - "@boardreadyops/plugin-altium-import"
  - "@boardreadyops/plugin-eagle-compat"
  - "./local-rules/custom-fab-check.js"
```

BoardReadyOps also auto-discovers installed packages named `@boardreadyops/plugin-*` or `boardreadyops-plugin-*`, and local JavaScript plugins under `./local-rules/*.js`. The SDK package itself, `@boardreadyops/plugin-sdk`, is ignored during auto-discovery because it provides types and `definePlugin`, not a runtime plugin.

Explicit config entries load first, followed by discovered package plugins and local plugins. Duplicate specifiers are ignored. Duplicate rule IDs from different plugins are reported as configuration findings.

## Packaging

Use one of the supported naming conventions:

- Scoped package: `@boardreadyops/plugin-your-name`
- Unscoped package: `boardreadyops-plugin-your-name`
- Local file: `./local-rules/your-check.js`

A minimal package should expose an ESM entrypoint:

```json
{
  "name": "boardreadyops-plugin-custom-rule",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./index.js"
  },
  "dependencies": {
    "@boardreadyops/plugin-sdk": "file:../boardreadyops/packages/plugin-sdk"
  }
}
```

The dependency path is illustrative: replace it with the relative path from the
plugin package to the BoardReadyOps checkout, or with the published SDK version
after `@boardreadyops/plugin-sdk` exists on npm. Before publishing, run the
plugin's own lint, typecheck, and tests. Consumers should pin plugin versions in
their package manager lockfile so CI runs the same plugin code as local
development.

## Trust Boundary

Plugins run in the same Node.js process as BoardReadyOps. They can read files available to the current process, run arbitrary JavaScript, and affect runtime behavior by registering rules or other extension points. Install plugins only from sources you trust, review local plugins like application code, and keep plugin dependencies updated.

BoardReadyOps validates the exported plugin shape with Zod before registering rules. Validation catches malformed metadata and missing plugin fields, but it is not a sandbox and does not restrict plugin code execution.

## Plugin trust model

BoardReadyOps v1 treats plugins and local rules as trusted workspace code. The permission model is an audit and approval mechanism: it records requested capabilities, allows maintainers to deny unexpected capabilities, and prevents registration when declared permissions are not approved. It does not yet provide process-level isolation, syscall filtering, network egress control, or a JavaScript runtime sandbox.

Only install or enable plugins from sources you review and trust. In CI, prefer explicit plugin lists in `boardreadyops.yml`, keep dependency updates reviewed, and treat any plugin that requests `fs:write`, `network`, `process`, or `kicad-cli` as security-sensitive. Runtime plugin isolation may be added in a later major release if the extension ecosystem grows beyond trusted project-local plugins.

## Current Extension Points

`rules` are active today and are registered into the BoardReadyOps rule registry. The SDK also reserves shapes for `adapters`, `reportFormats`, `vendorProfiles`, `notifiers`, and `supplierProviders` so plugin packages can expose those objects as the runtime integration points mature.

## Supplier Intelligence Providers

Plugins can contribute `supplierProviders` to enrich BOM risk analysis with real-time or static availability, lifecycle, and compliance data. The contract is provider-neutral: BoardReadyOps core never calls a specific commercial API directly.

```ts
import { definePlugin, type SupplierIntelligenceProvider } from "@boardreadyops/plugin-sdk";

const myProvider: SupplierIntelligenceProvider = {
  id: "my-supplier-api",
  name: "My Supplier API",
  requiresNetwork: true,
  async query(input) {
    const records = new Map();
    for (const { reference, mpn } of input.components) {
      if (!mpn) { continue; }
      // Call your API here...
      records.set(mpn.toUpperCase(), {
        mpn,
        lifecycleStatus: "active",
        supplierCount: 3,
        available: true,
        trust: "verified",
        fetchedAt: new Date().toISOString(),
      });
    }
    return { records, queriedAt: new Date().toISOString() };
  },
};

export default definePlugin({
  name: "boardreadyops-plugin-my-supplier",
  version: "1.0.0",
  permissions: ["network"],
  supplierProviders: [myProvider],
});
```

### Static supplier database

For projects without a live supplier API, use the built-in `createStaticSupplierProvider` to load a committed JSON database:

```ts
import { createStaticSupplierProvider } from "boardreadyops/bom/supplier";

const provider = createStaticSupplierProvider({
  dataFile: ".boardreadyops/supplier-db.json",
  name: "Project Supplier Database",
});
```

The database file format:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "records": [
    {
      "mpn": "TPS62840DLCT",
      "manufacturer": "Texas Instruments",
      "lifecycleStatus": "active",
      "supplierCount": 5,
      "available": true,
      "alternates": ["TPS62840DLCR"],
      "restrictedSubstances": false,
      "complianceNotes": ["RoHS compliant"],
      "leadTimeWeeks": 8,
      "trust": "verified"
    }
  ]
}
```

Supported `lifecycleStatus` values: `active`, `nrnd` (not recommended for new designs), `last-time-buy`, `eol` (end of life), `obsolete`, `unknown`.

Supported `trust` values: `verified`, `estimated`, `unverified`, `unknown`.

The provider warns when the database is older than 90 days.

### Provider trust and freshness warnings

Providers include `trust` and `fetchedAt` on each record. The `buildSupplierIntelligenceSummary` helper aggregates results across providers and produces per-component lifecycle warnings and a `freshness` status (`fresh`, `stale`, `unknown`). These are surfaced in the BOM risk report section for PR comments and the dashboard.

