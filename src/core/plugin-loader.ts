import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { BoardReadyOpsPlugin, PluginFinding, PluginRuleContext } from "../../packages/plugin-sdk/src/index.js";
import type { BoardReadyOpsConfig } from "./config.js";
import type { RuleContext } from "./context.js";
import { PluginError } from "./errors.js";
import { createFinding, type Finding, type FindingInput } from "./findings.js";
import {
  evaluatePluginPermissions,
  isPluginPermission,
  type LoadedPluginPermissions,
  type PluginPermission,
  pluginPermissionDenialMessage,
} from "./plugin-permissions.js";
import { type Rule, registerRule } from "./rule-registry.js";

export interface LoadedPlugin {
  specifier: string;
  name: string;
  version: string;
  ruleIds: string[];
  permissions: LoadedPluginPermissions;
}

export interface PluginLoadResult {
  specifiers: string[];
  plugins: LoadedPlugin[];
  errors: string[];
}

const scopedPluginPrefix = "plugin-";
const unscopedPluginPrefix = "boardreadyops-plugin-";
const sdkPackageName = "plugin-sdk";
const registeredPluginRules = new Map<string, string>();

const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);
const kicadVersionSchema = z.enum(["9", "10", "future"]);
const functionSchema = z.instanceof(Function);
const permissionSchema = z.custom<PluginPermission>(isPluginPermission, "valid plugin permission");

const ruleMetadataSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
  defaultSeverity: severitySchema,
  appliesTo: z.array(z.string().min(1)),
  configKeys: z.array(z.string()),
  kicadVersions: z.array(kicadVersionSchema),
  tags: z.array(z.string()),
  docUrl: z.string().url().optional(),
});

const ruleSchema = z.strictObject({
  meta: ruleMetadataSchema,
  run: functionSchema,
});

const extensionSchema = z.looseObject({
  id: z.string().min(1),
});

const rulePackOverrideSchema = z.union([
  z.boolean(),
  z.looseObject({ enabled: z.boolean().optional(), severity: z.string().optional() }),
]);

const rulePackSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  rules: z.record(z.string(), rulePackOverrideSchema).optional(),
  vendorProfile: z.string().optional(),
  releaseMode: z.enum(["prototype", "pilot", "production"]).optional(),
});

const compatibilitySchema = z.looseObject({
  boardreadyopsMin: z.string().optional(),
  boardreadyopsMax: z.string().optional(),
  kicadVersions: z.array(z.string()).optional(),
});

const pluginSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  permissions: z.array(permissionSchema).optional(),
  compatibility: compatibilitySchema.optional(),
  rules: z.array(ruleSchema).optional(),
  adapters: z.array(extensionSchema).optional(),
  reportFormats: z.array(extensionSchema).optional(),
  vendorProfiles: z.array(extensionSchema).optional(),
  notifiers: z.array(extensionSchema).optional(),
  rulePacks: z.array(rulePackSchema).optional(),
  supplierProviders: z.array(extensionSchema).optional(),
});

export async function discoverPluginSpecifiers(root: string, configuredPlugins: string[] = []): Promise<string[]> {
  const specifiers: string[] = [];
  const seen = new Set<string>();
  for (const specifier of configuredPlugins) {
    appendUnique(specifiers, seen, specifier);
  }
  for (const specifier of await discoverPackagePlugins(root)) {
    appendUnique(specifiers, seen, specifier);
  }
  for (const specifier of await discoverLocalPlugins(root)) {
    appendUnique(specifiers, seen, specifier);
  }
  return specifiers;
}

export async function loadPlugins(
  root: string,
  config: Pick<BoardReadyOpsConfig, "plugins" | "pluginPermissions">,
): Promise<PluginLoadResult> {
  const specifiers = await discoverPluginSpecifiers(root, config.plugins ?? []);
  const plugins: LoadedPlugin[] = [];
  const errors: string[] = [];

  for (const specifier of specifiers) {
    try {
      const entrypoint = resolvePluginEntrypoint(root, specifier);
      const module = await import(entrypoint);
      const plugin = validatePlugin(module, specifier);
      const permissions = evaluatePluginPermissions({
        specifier,
        name: plugin.name,
        requested: plugin.permissions,
        config: config.pluginPermissions,
      });
      if (permissions.denied.length > 0) {
        throw new PluginError(
          pluginPermissionDenialMessage({ specifier, name: plugin.name, denied: permissions.denied }),
          specifier,
        );
      }
      const ruleIds = registerPluginRules(plugin, specifier);
      plugins.push({
        specifier,
        name: plugin.name,
        version: plugin.version,
        ruleIds,
        permissions,
      });
    } catch (error) {
      errors.push(errorMessageFor(specifier, error));
    }
  }

  return { specifiers, plugins, errors };
}

export function clearPluginRegistrationsForTests(): void {
  registeredPluginRules.clear();
}

async function discoverPackagePlugins(root: string): Promise<string[]> {
  const scoped = await readDirectory(path.join(root, "node_modules", "@boardreadyops"));
  const scopedPlugins = scoped
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(scopedPluginPrefix) && entry.name !== sdkPackageName,
    )
    .map((entry) => `@boardreadyops/${entry.name}`)
    .sort((a, b) => a.localeCompare(b));

  const unscoped = await readDirectory(path.join(root, "node_modules"));
  const unscopedPlugins = unscoped
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(unscopedPluginPrefix))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return [...scopedPlugins, ...unscopedPlugins];
}

async function discoverLocalPlugins(root: string): Promise<string[]> {
  const localRules = await readDirectory(path.join(root, "local-rules"));
  return localRules
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `./local-rules/${entry.name}`)
    .sort((a, b) => a.localeCompare(b));
}

async function readDirectory(directory: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }
}

function resolvePluginEntrypoint(root: string, specifier: string): string {
  if (specifier.startsWith("file:")) {
    return specifier;
  }
  if (isPathSpecifier(specifier)) {
    return pathToFileURL(path.resolve(root, specifier)).href;
  }
  const requireFromRoot = createRequire(path.join(root, "boardreadyops-plugin-loader.cjs"));
  return pathToFileURL(requireFromRoot.resolve(specifier)).href;
}

function validatePlugin(module: unknown, specifier: string): BoardReadyOpsPlugin {
  const parsed = pluginSchema.safeParse(pluginExportFromModule(module));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const issuePath = issue.path.length > 0 ? `/${issue.path.join("/")}` : "/";
      return `${issuePath}: ${issue.message}`;
    });
    throw new PluginError(`Plugin "${specifier}" is invalid: ${issues.join("; ")}`, specifier);
  }
  return parsed.data as BoardReadyOpsPlugin;
}

function pluginExportFromModule(module: unknown): unknown {
  const namespace = module && typeof module === "object" ? (module as Record<string, unknown>) : {};
  return namespace.default ?? namespace.plugin ?? module;
}

function registerPluginRules(plugin: BoardReadyOpsPlugin, specifier: string): string[] {
  const rules = plugin.rules ?? [];
  assertUniqueRuleIds(
    rules.map((pluginRule) => pluginRule.meta.id),
    specifier,
  );
  const ruleIds: string[] = [];
  for (const pluginRule of rules) {
    const existingSpecifier = registeredPluginRules.get(pluginRule.meta.id);
    if (existingSpecifier === specifier) {
      ruleIds.push(pluginRule.meta.id);
      continue;
    }
    if (existingSpecifier) {
      throw new PluginError(
        `Plugin "${specifier}" rule "${pluginRule.meta.id}" duplicates rule from "${existingSpecifier}".`,
        specifier,
      );
    }
    try {
      registerRule(toCoreRule(pluginRule));
      registeredPluginRules.set(pluginRule.meta.id, specifier);
      ruleIds.push(pluginRule.meta.id);
    } catch (error) {
      throw new PluginError(
        `Plugin "${specifier}" rule "${pluginRule.meta.id}" could not be registered: ${messageFromError(error)}`,
        specifier,
      );
    }
  }
  return ruleIds;
}

function assertUniqueRuleIds(ruleIds: string[], specifier: string): void {
  const seen = new Set<string>();
  for (const ruleId of ruleIds) {
    if (seen.has(ruleId)) {
      throw new PluginError(`Plugin "${specifier}" defines duplicate rule id "${ruleId}".`, specifier);
    }
    seen.add(ruleId);
  }
}

function toCoreRule(pluginRule: NonNullable<BoardReadyOpsPlugin["rules"]>[number]): Rule {
  return {
    meta: pluginRule.meta,
    async run(context: RuleContext): Promise<Finding[]> {
      const findings = await pluginRule.run(context as unknown as PluginRuleContext);
      return findings.map(normalizePluginFinding);
    },
  };
}

function normalizePluginFinding(finding: PluginFinding): Finding {
  const input = finding as FindingInput;
  return typeof finding.fingerprint === "string" && finding.fingerprint.length > 0
    ? (finding as Finding)
    : createFinding(input);
}

function appendUnique(specifiers: string[], seen: Set<string>, specifier: string): void {
  if (!seen.has(specifier)) {
    seen.add(specifier);
    specifiers.push(specifier);
  }
}

function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/") || path.isAbsolute(specifier);
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessageFor(specifier: string, error: unknown): string {
  const message = messageFromError(error);
  return message.includes(`Plugin "${specifier}"`) ? message : `Plugin "${specifier}" could not be loaded: ${message}`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
