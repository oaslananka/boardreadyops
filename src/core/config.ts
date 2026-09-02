import path from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { cosmiconfig } from "cosmiconfig";
import * as yaml from "js-yaml";
import configSchema from "../../schemas/config.schema.json" with { type: "json" };
import { pathExists, readTextFile } from "../util/fs.js";
import { displayPath, normalizePathInput } from "../util/path.js";
import type { BoardReadyOpsConfig, LoadedConfig, RuleConfig } from "./config.types.js";
import { isSeverity, type Severity } from "./findings.js";

// Re-export the configuration type surface so existing `core/config` type
// imports keep working. The canonical definitions live in `config.types.ts`,
// which carries no runtime dependencies (AJV, cosmiconfig, js-yaml).
export type {
  BaselineConfig,
  BaseNotifierConfig,
  BoardReadyOpsConfig,
  EmailNotifierConfig,
  GateConfig,
  LoadedConfig,
  NotifiersConfig,
  PolicyConfig,
  PolicyRuleConfig,
  RuleConfig,
  SuppressionConfig,
  TelegramNotifierConfig,
  WaiverConfig,
  WebhookNotifierConfig,
} from "./config.types.js";

const configNames = ["boardreadyops.yml", ".boardreadyops.yml", "boardreadyops.yaml"];

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
(addFormats as unknown as (validator: Ajv2020) => void)(ajv);
const validate = ajv.compile(configSchema);

export async function loadConfig(root: string, configInput?: string): Promise<LoadedConfig> {
  try {
    const explicit =
      configInput && configInput.trim() !== "" ? path.resolve(root, normalizePathInput(configInput)) : undefined;
    if (explicit) {
      if (!(await pathExists(explicit))) {
        return {
          config: defaultConfig(),
          path: explicit,
          errors: [`config file not found: ${await displayPath(root, explicit)}`],
        };
      }
      return validateLoaded(await loadYamlFile(explicit), explicit);
    }
    const explorer = cosmiconfig("boardreadyops", {
      searchPlaces: configNames,
      loaders: {
        ".yml": yamlLoader,
        ".yaml": yamlLoader,
      },
    });
    const result = await explorer.search(root);
    if (!result?.config) {
      return { config: defaultConfig(), errors: [] };
    }
    return validateLoaded(result.config, result.filepath);
  } catch (error) {
    return {
      config: defaultConfig(),
      errors: [error instanceof Error ? error.message : "configuration could not be loaded"],
    };
  }
}

export function validateConfig(config: unknown): string[] {
  if (validate(config)) {
    return [];
  }
  return (validate.errors || []).map((error: ErrorObject) => {
    const pointer = error.instancePath || "/";
    return `${pointer}: ${error.message || "invalid value"}`;
  });
}

export function isRuleEnabled(config: BoardReadyOpsConfig, ruleId: string): boolean {
  const rule = config.rules?.[ruleId];
  if (typeof rule === "boolean") {
    return rule;
  }
  return rule?.enabled !== false;
}

export function ruleSeverity(config: BoardReadyOpsConfig, ruleId: string, defaultSeverity: Severity): Severity {
  const rule = config.rules?.[ruleId];
  if (typeof rule === "object" && isSeverity(rule.severity)) {
    return rule.severity;
  }
  return defaultSeverity;
}

export function ruleConfig(config: BoardReadyOpsConfig, ruleId: string): RuleConfig {
  const rule = config.rules?.[ruleId];
  return typeof rule === "object" && rule !== null ? rule : {};
}

export function defaultConfig(): BoardReadyOpsConfig {
  return { version: 1, mode: "warn", "fail-on": "high" };
}

async function loadYamlFile(file: string): Promise<unknown> {
  return loadYamlContent(await readTextFile(file));
}

function yamlLoader(_: string, content: string): unknown {
  return loadYamlContent(content);
}

export function loadYamlContent(content: string): unknown {
  return content.trim() === "" ? {} : yaml.load(content);
}

function validateLoaded(config: unknown, file: string): LoadedConfig {
  const candidate = config && typeof config === "object" ? config : {};
  const errors = validateConfig(candidate);
  if (errors.length > 0) {
    return { config: defaultConfig(), path: file, errors };
  }
  return { config: candidate as BoardReadyOpsConfig, path: file, errors: [] };
}
