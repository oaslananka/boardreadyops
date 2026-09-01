import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { validateConfig } from "../../../src/core/config.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import {
  clearPluginRegistrationsForTests,
  discoverPluginSpecifiers,
  loadPlugins,
} from "../../../src/core/plugin-loader.js";
import { clearRulesForTests } from "../../../src/core/rule-registry.js";
import { registerBuiltInRules, resetBuiltInRuleRegistrationForTests } from "../../../src/rules/_index.js";

const safeBasicFixture = path.resolve("tests/fixtures/projects/safe-basic");

describe("plugin loader", () => {
  beforeEach(() => {
    clearRulesForTests();
    resetBuiltInRuleRegistrationForTests();
    clearPluginRegistrationsForTests();
  });

  it("accepts plugin entries in the BoardReadyOps config schema", () => {
    expect(validateConfig({ version: 1, plugins: ["@boardreadyops/plugin-fab", "./local-rules/check.js"] })).toEqual(
      [],
    );
    expect(validateConfig({ version: 1, plugins: [42] })).not.toEqual([]);
    expect(
      validateConfig({
        version: 1,
        pluginPermissions: {
          allow: { "@boardreadyops/plugin-fab": ["fs:read"], "*": ["kicad-cli"] },
          deny: { "risky-plugin": ["process"] },
        },
      }),
    ).toEqual([]);
    expect(validateConfig({ version: 1, pluginPermissions: { allow: { bad: ["root"] } } })).not.toEqual([]);
  });

  it("discovers configured, package, and local plugin specifiers deterministically", async () => {
    const root = await makeProjectRoot();
    await fs.mkdir(path.join(root, "node_modules", "@boardreadyops", "plugin-fab"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "@boardreadyops", "plugin-zed"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "@boardreadyops", "plugin-sdk"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "boardreadyops-plugin-vendor"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "boardreadyops-plugin-zed"), { recursive: true });
    await fs.mkdir(path.join(root, "local-rules"), { recursive: true });
    await fs.writeFile(path.join(root, "local-rules", "custom-fab-check.js"), "", "utf8");
    await fs.writeFile(path.join(root, "local-rules", "zed-check.js"), "", "utf8");

    await expect(discoverPluginSpecifiers(root, ["./explicit.js", "boardreadyops-plugin-vendor"])).resolves.toEqual([
      "./explicit.js",
      "boardreadyops-plugin-vendor",
      "@boardreadyops/plugin-fab",
      "@boardreadyops/plugin-zed",
      "boardreadyops-plugin-zed",
      "./local-rules/custom-fab-check.js",
      "./local-rules/zed-check.js",
    ]);
  });

  it("surfaces discovery directory errors that are not missing paths", async () => {
    const root = await makeProjectRoot();
    await fs.writeFile(path.join(root, "local-rules"), "not a directory\n", "utf8");

    await expect(discoverPluginSpecifiers(root)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });

  it("loads local plugins and registers their rules", async () => {
    const root = await makeProjectRoot();
    await fs.mkdir(path.join(root, "local-rules"), { recursive: true });
    await writeRulePlugin(path.join(root, "local-rules", "custom-fab-check.js"), {
      name: "custom-local",
      ruleId: "plugin.local-hello",
      message: "Local plugin rule ran.",
    });

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.local-hello"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "plugin.local-hello",
        severity: "info",
        message: "Local plugin rule ran.",
      }),
    ]);
  });

  it("does not import repository plugins under the safe execution policy", async () => {
    const root = await makeProjectRoot();
    await fs.mkdir(path.join(root, "local-rules"), { recursive: true });
    await fs.writeFile(
      path.join(root, "local-rules", "must-not-load.js"),
      'throw new Error("safe execution imported repository plugin code");\n',
      "utf8",
    );

    const result = await runPipeline({
      path: root,
      executionPolicy: "safe",
      failOn: "never",
      rules: ["release.revision-set"],
    });

    expect(result.plugins).toEqual([]);
    expect(result.findings.some((finding) => finding.message.includes("repository plugin code"))).toBe(false);
  });

  it("loads node_modules plugin packages by naming convention", async () => {
    const root = await makeProjectRoot();
    const packageRoot = path.join(root, "node_modules", "boardreadyops-plugin-vendor");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "boardreadyops-plugin-vendor", version: "1.0.0", type: "module", main: "index.js" }),
      "utf8",
    );
    await writeRulePlugin(path.join(packageRoot, "index.js"), {
      name: "vendor-package",
      ruleId: "plugin.vendor-hello",
      message: "Vendor package plugin rule ran.",
    });

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.vendor-hello"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "plugin.vendor-hello",
        severity: "info",
        message: "Vendor package plugin rule ran.",
      }),
    ]);
  });

  it("loads file URL plugins and treats repeat loads from the same specifier as idempotent", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "file-url-plugin.js");
    const specifier = pathToFileURL(pluginFile).href;
    await writeRulePlugin(pluginFile, {
      name: "file-url-plugin",
      ruleId: "plugin.file-url",
      message: "File URL plugin rule ran.",
    });

    await expect(loadPlugins(root, { plugins: [specifier] })).resolves.toMatchObject({
      errors: [],
      plugins: [
        {
          specifier,
          ruleIds: ["plugin.file-url"],
        },
      ],
    });
    await expect(loadPlugins(root, { plugins: [specifier] })).resolves.toMatchObject({
      errors: [],
      plugins: [
        {
          specifier,
          ruleIds: ["plugin.file-url"],
        },
      ],
    });
  });

  it("reports invalid plugin shapes as configuration findings", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "invalid-plugin.js");
    await fs.writeFile(
      pluginFile,
      "export default { name: 'invalid-plugin', version: '1.0.0', rules: [{ meta: { id: 'plugin.invalid' }, run: 'no' }] };\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(pluginFile)}\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.invalid"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "config.invalid",
        severity: "high",
        message: expect.stringContaining("Plugin"),
      }),
    ]);
    expect(result.findings[0]?.message).toContain("is invalid");
  });

  it("reports plugin modules that cannot resolve or do not export objects", async () => {
    const root = await makeProjectRoot();
    const primitivePlugin = path.join(root, "primitive-plugin.js");
    await fs.writeFile(primitivePlugin, "export default 'not a plugin';\n", "utf8");

    const result = await loadPlugins(root, {
      plugins: [primitivePlugin, "boardreadyops-plugin-missing"],
    });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.stringContaining(`Plugin "${primitivePlugin}" is invalid`),
      expect.stringContaining('Plugin "boardreadyops-plugin-missing" could not be loaded'),
    ]);
  });

  it("reports duplicate rule ids inside one plugin before registering it", async () => {
    const root = await makeProjectRoot();
    const duplicatePlugin = path.join(root, "duplicate-plugin.js");
    await writeRulePlugin(duplicatePlugin, {
      name: "duplicate-plugin",
      ruleId: "plugin.duplicate",
      message: "Duplicate plugin rule ran.",
      duplicateRule: true,
    });

    const result = await loadPlugins(root, { plugins: [duplicatePlugin] });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.stringContaining(`Plugin "${duplicatePlugin}" defines duplicate rule id "plugin.duplicate".`),
    ]);
  });

  it("reports duplicate rule ids across different plugins", async () => {
    const root = await makeProjectRoot();
    const firstPlugin = path.join(root, "first-plugin.js");
    const secondPlugin = path.join(root, "second-plugin.js");
    await writeRulePlugin(firstPlugin, {
      name: "first-plugin",
      ruleId: "plugin.shared",
      message: "First shared plugin rule ran.",
    });
    await writeRulePlugin(secondPlugin, {
      name: "second-plugin",
      ruleId: "plugin.shared",
      message: "Second shared plugin rule ran.",
    });

    const result = await loadPlugins(root, { plugins: [firstPlugin, secondPlugin] });

    expect(result.plugins).toEqual([
      expect.objectContaining({
        specifier: firstPlugin,
        ruleIds: ["plugin.shared"],
      }),
    ]);
    expect(result.errors).toEqual([
      expect.stringContaining(`Plugin "${secondPlugin}" rule "plugin.shared" duplicates rule from "${firstPlugin}".`),
    ]);
  });

  it("reports plugin rule ids that collide with built-in rules", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "builtin-collision.js");
    registerBuiltInRules();
    await writeRulePlugin(pluginFile, {
      name: "builtin-collision",
      ruleId: "release.revision-set",
      message: "Builtin collision rule ran.",
    });

    const result = await loadPlugins(root, { plugins: [pluginFile] });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.stringContaining(
        `Plugin "${pluginFile}" rule "release.revision-set" could not be registered: Duplicate rule id: release.revision-set`,
      ),
    ]);
  });

  it("loads named plugin exports and preserves plugin-provided fingerprints", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "named-plugin.js");
    const fingerprint = "b".repeat(64);
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(pluginFile)}\n`,
      "utf8",
    );
    await writeRulePlugin(pluginFile, {
      name: "named-plugin",
      ruleId: "plugin.named",
      message: "Named plugin rule ran.",
      exportName: "plugin",
      fingerprint,
    });

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.named"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "plugin.named",
        fingerprint,
      }),
    ]);
  });

  it("denies plugins that request unapproved permissions before registering rules", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "permissioned-plugin.js");
    await writeRulePlugin(pluginFile, {
      name: "permissioned-plugin",
      ruleId: "plugin.permissioned",
      message: "Permissioned plugin rule ran.",
      permissions: ["fs:read", "process"],
    });
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(pluginFile)}\npluginPermissions:\n  allow:\n    permissioned-plugin:\n      - fs:read\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.permissioned"] });

    expect(result.plugins).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "config.invalid",
        severity: "high",
        message: expect.stringContaining("requests unapproved permission"),
      }),
    ]);
    expect(result.findings[0]?.message).toContain("process");
  });

  it("loads plugins with approved permissions and records their audit metadata", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "approved-plugin.js");
    await writeRulePlugin(pluginFile, {
      name: "approved-plugin",
      ruleId: "plugin.approved",
      message: "Approved plugin rule ran.",
      permissions: ["fs:read", "kicad-cli"],
    });
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(pluginFile)}\npluginPermissions:\n  allow:\n    approved-plugin:\n      - fs:read\n    ${JSON.stringify(pluginFile)}:\n      - kicad-cli\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.approved"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "plugin.approved",
        message: "Approved plugin rule ran.",
      }),
    ]);
    expect(result.plugins).toEqual([
      expect.objectContaining({
        specifier: pluginFile,
        name: "approved-plugin",
        permissions: {
          requested: ["fs:read", "kicad-cli"],
          allowed: ["fs:read", "kicad-cli"],
          denied: [],
          approvedBy: [pluginFile, "approved-plugin"],
        },
      }),
    ]);
  });

  it("honors explicit deny entries over wildcard plugin permission grants", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "denied-plugin.js");
    await writeRulePlugin(pluginFile, {
      name: "denied-plugin",
      ruleId: "plugin.denied",
      message: "Denied plugin rule ran.",
      permissions: ["network"],
    });
    const result = await loadPlugins(root, {
      plugins: [pluginFile],
      pluginPermissions: { allow: { "*": ["network"] }, deny: { "denied-plugin": ["network"] } },
    });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining("network")]);
  });

  it("blocks plugins declaring unapproved permissions in static package.json before execution", async () => {
    const root = await makeProjectRoot();
    const pkgDir = path.join(root, "node_modules", "boardreadyops-plugin-risky");
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "boardreadyops-plugin-risky",
        version: "1.0.0",
        type: "module",
        main: "index.js",
        boardreadyops: {
          permissions: ["process"],
        },
      }),
      "utf8",
    );
    // index.js has top-level throw; if pre-check works, it must not execute
    await fs.writeFile(
      path.join(pkgDir, "index.js"),
      'throw new Error("Malicious top-level code executed!");\n',
      "utf8",
    );

    const result = await loadPlugins(root, {
      plugins: ["boardreadyops-plugin-risky"],
      pluginPermissions: { allow: {} },
    });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining("requests unapproved permission: process")]);
  });

  it("normalizes a plugin rule that returns non-array output into a config.invalid finding", async () => {
    const root = await makeProjectRoot();
    const pluginFile = path.join(root, "non-array-plugin.js");
    await fs.writeFile(
      pluginFile,
      `export default {
  name: "non-array-plugin",
  version: "1.0.0",
  rules: [
    {
      meta: {
        id: "plugin.non-array",
        title: "Non-array",
        description: "Returns something that isn't an array",
        rationale: "Testing non-array output normalization",
        defaultSeverity: "info",
        appliesTo: ["project"],
        configKeys: [],
        kicadVersions: ["9", "10", "future"],
        tags: ["plugin"]
      },
      run() {
        return { notAnArray: true };
      }
    }
  ]
};`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(pluginFile)}\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.non-array"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "config.invalid",
        severity: "high",
        message: expect.stringContaining("returned non-array output"),
      }),
    ]);
  });

  it("falls back to a directory-adjacent package.json when a path-specifier plugin file doesn't exist", async () => {
    const root = await makeProjectRoot();
    const missingPlugin = path.join(root, "does-not-exist.js");

    const result = await loadPlugins(root, {
      plugins: [missingPlugin],
      pluginPermissions: { allow: {} },
    });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining(missingPlugin)]);
  });

  it("runs the shipped example plugin end-to-end through the SDK package", async () => {
    const root = await makeProjectRoot();
    const examplePlugin = path.resolve("examples/plugin-custom-rule/index.js");
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(examplePlugin)}\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.hello-world"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "plugin.hello-world",
        severity: "info",
        message: "Hello from a BoardReadyOps plugin.",
      }),
    ]);
  });

  it("documents the known trust-boundary limit: permissions declared only on the exported object still run top-level code before the permission decision (ADR 0009)", async () => {
    const root = await makeProjectRoot();
    const markerFile = path.join(root, "import-ran.marker");
    const pluginFile = path.join(root, "undeclared-permissions-plugin.js");
    await fs.writeFile(
      pluginFile,
      `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(markerFile)}, "ran");
export default {
  name: "undeclared-permissions-plugin",
  version: "1.0.0",
  permissions: ["process"],
  rules: [],
};
`,
      "utf8",
    );

    const result = await loadPlugins(root, {
      plugins: [pluginFile],
      pluginPermissions: { allow: {} },
    });

    // Denied, because nothing allows "process" — but only after the module already ran.
    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining("process")]);
    // There is no static package.json manifest to pre-check for a bare path-specifier
    // plugin, and the loader must import the module to read its exported `permissions`
    // in the first place. The marker file proves the top-level code already executed
    // before the denial was known. This is the accepted, documented trust boundary
    // (ADR 0009): standard-mode plugins are trusted workspace code, not sandboxed.
    await expect(fs.stat(markerFile)).resolves.toBeDefined();
  });

  it("safely contains plugin rules that throw during execution", async () => {
    const root = await makeProjectRoot();
    const crashingPlugin = path.join(root, "crashing-plugin.js");
    await fs.writeFile(
      crashingPlugin,
      `export default {
  name: "crashing-plugin",
  version: "1.0.0",
  rules: [
    {
      meta: {
        id: "plugin.crasher",
        title: "Crasher",
        description: "Throws at runtime",
        rationale: "Testing failure isolation",
        defaultSeverity: "info",
        appliesTo: ["project"],
        configKeys: [],
        kicadVersions: ["9", "10", "future"],
        tags: ["plugin"]
      },
      run() {
        throw new Error("Simulated plugin runtime panic");
      }
    }
  ]
};`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(crashingPlugin)}\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.crasher"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "config.invalid",
        severity: "high",
        message: expect.stringContaining("Simulated plugin runtime panic"),
      }),
    ]);
  });

  it("safely contains a plugin rule that throws a non-Error value", async () => {
    const root = await makeProjectRoot();
    const crashingPlugin = path.join(root, "string-throw-plugin.js");
    await fs.writeFile(
      crashingPlugin,
      `export default {
  name: "string-throw-plugin",
  version: "1.0.0",
  rules: [
    {
      meta: {
        id: "plugin.string-thrower",
        title: "String thrower",
        description: "Throws a plain string instead of an Error",
        rationale: "Testing non-Error throw normalization",
        defaultSeverity: "info",
        appliesTo: ["project"],
        configKeys: [],
        kicadVersions: ["9", "10", "future"],
        tags: ["plugin"]
      },
      run() {
        throw "boom";
      }
    }
  ]
};`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1\nplugins:\n  - ${JSON.stringify(crashingPlugin)}\n`,
      "utf8",
    );

    const result = await runPipeline({ path: root, failOn: "never", rules: ["plugin.string-thrower"] });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "config.invalid",
        severity: "high",
        message: expect.stringContaining("unknown error"),
      }),
    ]);
  });

  it("falls back to the specifier for the denial message when a static manifest has permissions but no name", async () => {
    const root = await makeProjectRoot();
    const pkgDir = path.join(root, "node_modules", "boardreadyops-plugin-unnamed");
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        version: "1.0.0",
        type: "module",
        main: "index.js",
        boardreadyops: { permissions: ["network"] },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(pkgDir, "index.js"), 'throw new Error("must not run");\n', "utf8");

    const result = await loadPlugins(root, {
      plugins: ["boardreadyops-plugin-unnamed"],
      pluginPermissions: { allow: {} },
    });

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining("boardreadyops-plugin-unnamed")]);
  });

  it("accepts a plugin that declares extension points other than rules", async () => {
    const root = await makeProjectRoot();
    const noRulesPlugin = path.join(root, "no-rules-plugin.js");
    await fs.writeFile(
      noRulesPlugin,
      `export default {
  name: "no-rules-plugin",
  version: "1.0.0"
};`,
      "utf8",
    );

    const result = await loadPlugins(root, {
      plugins: [noRulesPlugin],
      pluginPermissions: { allow: {} },
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins).toEqual([expect.objectContaining({ name: "no-rules-plugin", ruleIds: [] })]);
  });
});

async function makeProjectRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-plugin-"));
  await fs.cp(safeBasicFixture, root, { recursive: true });
  return root;
}

async function writeRulePlugin(
  file: string,
  input: {
    name: string;
    ruleId: string;
    message: string;
    duplicateRule?: boolean;
    exportName?: "default" | "plugin";
    fingerprint?: string;
    permissions?: string[];
  },
): Promise<void> {
  const exportPrefix = input.exportName === "plugin" ? "export const plugin =" : "export default";
  const rules = [ruleSource(input), ...(input.duplicateRule ? [ruleSource(input)] : [])];
  await fs.writeFile(
    file,
    `${exportPrefix} {
  name: ${JSON.stringify(input.name)},
  version: "1.0.0",
${input.permissions ? `  permissions: ${JSON.stringify(input.permissions)},\n` : ""}  rules: [
${rules.join(",\n")}
  ]
};
`,
    "utf8",
  );
}

function ruleSource(input: { ruleId: string; message: string; fingerprint?: string }): string {
  const fingerprint = input.fingerprint ? `,\n            fingerprint: ${JSON.stringify(input.fingerprint)}` : "";
  return `    {
      meta: {
        id: ${JSON.stringify(input.ruleId)},
        title: "Plugin hello",
        description: "Exercises plugin loading.",
        rationale: "Plugin rules should be registered by the loader.",
        defaultSeverity: "info",
        appliesTo: ["project"],
        configKeys: [],
        kicadVersions: ["9", "10", "future"],
        tags: ["plugin"]
      },
      async run(context) {
        return [
          {
            ruleId: ${JSON.stringify(input.ruleId)},
            severity: "info",
            message: ${JSON.stringify(input.message)},
            project: context.projects[0]?.projectFile,
            resource: { path: context.projects[0]?.projectFile ?? ".", kind: "project" },
            confidence: "definite"${fingerprint}
          }
        ];
      }
    }`;
}
