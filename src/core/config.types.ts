/**
 * Type definitions for the BoardReadyOps configuration file.
 *
 * These types are used by {@link config.ts} for loading and validation,
 * and by downstream modules that consume configuration values.
 *
 * The source-of-truth JSON Schema lives at `schemas/config.schema.json`.
 */

import type { VendorProfileConfig } from "../vendor/profiles.js";
import type { FailOn, Severity } from "./findings.js";
import type { PluginPermissionGrantConfig } from "./plugin-permissions.js";

/** Manufacturing release context that controls severity thresholds, required artifacts, and waiver behavior. */
export type ReleaseMode = "prototype" | "pilot" | "production";

export interface RuleConfig {
  enabled?: boolean;
  severity?: Severity;
  required?: string[];
  patterns?: Record<string, string[]>;
  "severity-overrides"?: Record<string, Severity>;
  "ignore-refs"?: string[];
  [key: string]: unknown;
}

interface FirmwareConfig {
  platformio?:
    | {
        pinAssignments?: string | undefined;
      }
    | undefined;
  arduino?:
    | {
        pinAssignments?: string | undefined;
      }
    | undefined;
  zephyr?:
    | {
        pinAssignments?: string | undefined;
      }
    | undefined;
  "esp-idf"?:
    | {
        pinAssignments?: string | undefined;
      }
    | undefined;
  stm32cubemx?:
    | {
        project?: string | undefined;
        mcuDesignator?: string | undefined;
      }
    | undefined;
}

interface ProjectConfig {
  path: string;
  mode?: "warn" | "enforce";
  releaseMode?: ReleaseMode;
  pinmap?: string;
  bom?: string;
  vendor?: VendorProfileConfig;
  firmware?: FirmwareConfig;
  rules?: Record<string, RuleConfig | boolean>;
  variants?: Array<{
    name: string;
    bom?: string;
  }>;
}

export interface SuppressionConfig {
  rule: string;
  project?: string;
  reason: string;
  expires?: string;
  refs?: string[];
  fingerprint?: string;
}

export interface WaiverConfig {
  rule: string;
  fingerprint?: string;
  project?: string;
  owner: string;
  reason: string;
  expires?: string;
  approvedBy?: string;
  evidence?: string;
}

export interface BaselineConfig {
  file: string;
  mode: "new-only" | "all";
}

interface FixConfig {
  allow?: string[];
}

export interface GateConfig {
  "fail-on"?: FailOn;
  require?: string[];
}

type PolicyRuleType =
  | "max-severity"
  | "max-findings"
  | "min-readiness-score"
  | "require-readiness-status"
  | "require-required-outputs"
  | "forbid-rules"
  | "forbid-expired-waivers"
  | "forbid-stale-waivers";

export interface PolicyRuleConfig {
  id: string;
  type: PolicyRuleType;
  severity?: Severity;
  max?: number;
  score?: number;
  status?: Array<"ready" | "at-risk" | "blocked">;
  rules?: string[];
}

export interface PolicyConfig {
  enforce?: boolean;
  rules?: PolicyRuleConfig[];
}

export interface BaseNotifierConfig {
  enabled?: boolean;
  minSeverity?: Severity;
}

export interface WebhookNotifierConfig extends BaseNotifierConfig {
  webhookEnv?: string;
}

export interface TelegramNotifierConfig extends BaseNotifierConfig {
  botTokenEnv?: string;
  chatId?: string;
}

export interface EmailNotifierConfig extends BaseNotifierConfig {
  smtpEnv?: string;
  from?: string;
  recipients?: string[];
}

export interface NotifiersConfig {
  slack?: WebhookNotifierConfig;
  teams?: WebhookNotifierConfig;
  telegram?: TelegramNotifierConfig;
  discord?: WebhookNotifierConfig;
  email?: EmailNotifierConfig;
}

/** A single approved alternate part for a primary MPN. */
interface BomAlternate {
  /** Manufacturer part number of the approved alternate. */
  mpn: string;
  /** Manufacturer name (informational). */
  manufacturer?: string | undefined;
  /** Free-form note, e.g. "Verified compatible at Rev1 prototype". */
  note?: string | undefined;
}

/** Maps a primary MPN to one or more tested, approved substitute parts. */
interface BomAlternateEntry {
  /** Primary MPN this alternate list applies to. */
  mpn: string;
  /** One or more approved substitute parts. */
  alts: BomAlternate[];
}

interface BomTopLevelConfig {
  /**
   * Approved alternate parts for BOM supply chain risk management.
   * MPNs listed here have documented approved substitutes, so single-source
   * risk findings will not be raised for them.
   */
  alternates?: BomAlternateEntry[] | undefined;
}

export interface BoardReadyOpsConfig {
  version: 1;
  mode?: "warn" | "enforce";
  releaseMode?: ReleaseMode;
  plugins?: string[];
  pluginPermissions?: PluginPermissionGrantConfig;
  vendor?: VendorProfileConfig;
  firmware?: FirmwareConfig;
  bom?: BomTopLevelConfig;
  projects?: ProjectConfig[];
  rules?: Record<string, RuleConfig | boolean>;
  "fail-on"?: FailOn;
  gates?: Record<string, GateConfig>;
  policy?: PolicyConfig;
  waivers?: WaiverConfig[];
  suppressions?: SuppressionConfig[];
  baseline?: BaselineConfig;
  fix?: FixConfig;
  notifiers?: NotifiersConfig;
  report?: {
    sarif?: string | false;
    json?: string | false;
    markdown?: string | false;
    junit?: string | false;
    html?: string | false;
  };
}

export interface LoadedConfig {
  config: BoardReadyOpsConfig;
  path?: string;
  errors: string[];
}
