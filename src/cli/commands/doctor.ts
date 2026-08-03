import path from "node:path";
import * as yaml from "js-yaml";
import { loadConfig } from "../../core/config.js";
import { discoverProjects } from "../../core/discovery.js";
import { boardReadyVersion } from "../../generated/version.js";
import { type Locale, type MessageKey, type MessageParams, resolveLocale, t } from "../../i18n/t.js";
import { detectKicadCli } from "../../kicad/cli.js";
import { readTextFile } from "../../util/fs.js";
import { runProcess } from "../../util/process.js";
import {
  discoverGerberOutputs,
  findBoardReadyWorkflow,
  firstExisting,
  hasPullRequestCommentPermission,
  isCheckoutUse,
  isPinnedCheckoutUse,
  workflowUses,
} from "./doctor-workflow.js";

const doctorChecks = ["runtime", "kicad", "adapters", "repository", "suppressions", "action"] as const;
const supportedNodeMajors = new Set([22, 24]);

type DoctorCheckName = (typeof doctorChecks)[number];
type DoctorSeverity = "pass" | "warn" | "fail" | "info";

export interface DoctorCommandOptions {
  check?: string | undefined;
  config?: string | undefined;
  format?: string | undefined;
}

interface DoctorItem {
  severity: DoctorSeverity;
  message: string;
  recommendation?: string | undefined;
  messageKey?: MessageKey | undefined;
  messageParams?: MessageParams | undefined;
  recommendationKey?: MessageKey | undefined;
  recommendationParams?: MessageParams | undefined;
}

interface DoctorCheck {
  name: DoctorCheckName;
  title: string;
  items: DoctorItem[];
}

interface DoctorReport {
  schemaVersion: 1;
  tool: {
    name: "boardreadyops";
    version: string;
  };
  checks: DoctorCheck[];
  recommendations: string[];
}

export async function doctorCommand(
  options: DoctorCommandOptions,
  streams: { stdout: NodeJS.WritableStream },
): Promise<number> {
  const format = parseDoctorFormat(options.format);
  const report = await createDoctorReport(options.check, options.config);
  streams.stdout.write(
    format === "json"
      ? `${JSON.stringify(publicDoctorReport(report), null, 2)}\n`
      : renderText(report, resolveLocale()),
  );
  return 0;
}

async function createDoctorReport(
  selected: string | undefined,
  configInput: string | undefined,
): Promise<DoctorReport> {
  const selectedCheck = parseDoctorCheck(selected);
  const checks = await Promise.all(
    [
      { name: "runtime" as const, title: "Runtime", run: runtimeCheck },
      { name: "kicad" as const, title: "KiCad", run: kicadCheck },
      { name: "adapters" as const, title: "Adapters", run: adaptersCheck },
      {
        name: "repository" as const,
        title: "Repository",
        run: (root: string) => repositoryCheck(root, configInput),
      },
      { name: "suppressions" as const, title: "Suppressions", run: suppressionsCheck },
      { name: "action" as const, title: "Action / Workflow", run: actionCheck },
    ]
      .filter((check) => !selectedCheck || check.name === selectedCheck)
      .map(async (check) => ({
        name: check.name,
        title: check.title,
        items: await check.run(process.cwd()),
      })),
  );
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: boardReadyVersion },
    checks,
    recommendations: collectRecommendations(checks),
  };
}

function renderText(report: DoctorReport, locale: Locale): string {
  const checks = report.checks
    .map(
      (check) =>
        `${localizedCheckTitle(check.name, locale)}\n${check.items
          .map((entry) => `  ${renderItem(entry, locale)}`)
          .join("\n")}`,
    )
    .join("\n\n");
  const localizedRecommendations = collectLocalizedRecommendations(report.checks, locale);
  const recommendations =
    localizedRecommendations.length === 0
      ? ""
      : `\n\n${t("doctor.recommendations", {}, locale)}\n${localizedRecommendations
          .map((recommendation, index) => `  ${index + 1}. ${recommendation}`)
          .join("\n")}`;
  return `${t("doctor.title", {}, locale)}\n\n${checks}${recommendations}\n`;
}

async function runtimeCheck(): Promise<DoctorItem[]> {
  const npmVersion = await runProcess("npm", ["--version"], {
    timeoutMs: 2_000,
    maxStdoutBytes: 4 * 1024,
    maxStderrBytes: 4 * 1024,
  });
  const supportedNode = supportsDoctorNodeVersion(process.versions.node);
  return [
    item(supportedNode ? "pass" : "fail", `Node: ${process.version} (supported majors: 22, 24)`, {
      recommendation: supportedNode ? undefined : "Install a supported Node.js 22 or 24 runtime.",
      messageKey: "doctor.runtime.node",
      messageParams: { version: process.version, majors: "22, 24" },
      recommendationKey: supportedNode ? undefined : "doctor.recommendation.runtime.node",
    }),
    item("pass", `boardreadyops: v${boardReadyVersion}`, {
      messageKey: "doctor.runtime.boardreadyops",
      messageParams: { version: boardReadyVersion },
    }),
    npmVersion.code === 0
      ? item("pass", `npm: v${npmVersion.stdout.trim()}`, {
          messageKey: "doctor.runtime.npm",
          messageParams: { version: npmVersion.stdout.trim() },
        })
      : item("warn", "npm not found.", {
          recommendation: "Install npm for package-based BoardReadyOps workflows.",
          messageKey: "doctor.runtime.npmMissing",
          recommendationKey: "doctor.recommendation.runtime.npm",
        }),
  ];
}

async function kicadCheck(): Promise<DoctorItem[]> {
  const kicad = await detectKicadCli();
  if (!kicad.found) {
    return [
      item("warn", "kicad-cli not found.", {
        recommendation: "Install KiCad CLI to run DRC and ERC checks.",
        messageKey: "doctor.kicad.missing",
        recommendationKey: "doctor.recommendation.kicad",
      }),
    ];
  }
  const version = kicad.version ? ` ${kicad.version}` : "";
  return [
    item("pass", `kicad-cli${version} found at ${kicad.path}.`, {
      messageKey: "doctor.kicad.found",
      messageParams: { version, path: kicad.path ?? "" },
    }),
    item("pass", "DRC available.", { messageKey: "doctor.kicad.drcAvailable" }),
    item("pass", "ERC available.", { messageKey: "doctor.kicad.ercAvailable" }),
  ];
}

async function adaptersCheck(): Promise<DoctorItem[]> {
  if (process.env.NEXAR_CLIENT_ID && process.env.NEXAR_CLIENT_SECRET) {
    return [item("pass", "Nexar credentials present.", { messageKey: "doctor.adapters.nexarPresent" })];
  }
  return [
    item("warn", "Nexar credentials not present.", {
      recommendation: "Set NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET for Nexar-backed lifecycle checks.",
      messageKey: "doctor.adapters.nexarMissing",
      recommendationKey: "doctor.recommendation.adapters.nexar",
    }),
  ];
}

async function repositoryCheck(root: string, configInput?: string): Promise<DoctorItem[]> {
  const [loaded, projects] = await Promise.all([loadConfig(root, configInput), discoverProjects(root)]);
  const gerbers = await discoverGerberOutputs(root, projects);
  const items: DoctorItem[] = [];
  if (loaded.errors.length > 0) {
    items.push(
      item("fail", `boardreadyops configuration is invalid: ${loaded.errors.join("; ")}`, {
        recommendation: "Fix boardreadyops.yml before running repository checks.",
        messageKey: "doctor.repository.configInvalid",
        messageParams: { errors: loaded.errors.join("; ") },
        recommendationKey: "doctor.recommendation.repository.config",
      }),
    );
  } else if (loaded.path) {
    items.push(
      item("pass", `${path.basename(loaded.path)} found and valid.`, {
        messageKey: "doctor.repository.configFound",
        messageParams: { file: path.basename(loaded.path) },
      }),
    );
  } else {
    items.push(
      item("info", "No boardreadyops configuration file found; defaults are valid.", {
        messageKey: "doctor.repository.noConfig",
      }),
    );
  }
  items.push(
    projects.length === 0
      ? item("warn", "No KiCad projects discovered.", {
          recommendation: "Add a .kicad_pro project before CI.",
          messageKey: "doctor.repository.noProjects",
          recommendationKey: "doctor.recommendation.repository.projects",
        })
      : item(
          projects.length === 1 ? "pass" : "warn",
          `${projects.length} KiCad project${plural(projects.length)} discovered.`,
          {
            messageKey: "doctor.repository.projectsDiscovered",
            messageParams: { count: projects.length },
          },
        ),
    gerbers.length === 0
      ? item("fail", "No Gerber outputs found.", {
          recommendation: "Generate Gerber outputs from KiCad before CI.",
          messageKey: "doctor.repository.noGerbers",
          recommendationKey: "doctor.recommendation.repository.gerbers",
        })
      : item("pass", `${gerbers.length} Gerber output${plural(gerbers.length)} found.`, {
          messageKey: "doctor.repository.gerbersDiscovered",
          messageParams: { count: gerbers.length },
        }),
  );
  return items;
}

async function suppressionsCheck(root: string): Promise<DoctorItem[]> {
  const [suppressionsFile, baselineFile] = await Promise.all([
    firstExisting(root, [
      ".boardreadyops-suppressions.yml",
      ".boardreadyops-suppressions.yaml",
      ".boardreadyops-suppressions.json",
    ]),
    firstExisting(root, [".boardreadyops-baseline.json"]),
  ]);
  return [
    suppressionsFile
      ? item("info", `${suppressionsFile} suppressions file found.`, {
          messageKey: "doctor.suppressions.suppressionsFound",
          messageParams: { file: suppressionsFile },
        })
      : item("pass", "No suppressions file found.", { messageKey: "doctor.suppressions.noSuppressions" }),
    baselineFile
      ? item("info", `${baselineFile} baseline found.`, {
          messageKey: "doctor.suppressions.baselineFound",
          messageParams: { file: baselineFile },
        })
      : item("info", "No baseline captured.", { messageKey: "doctor.suppressions.noBaseline" }),
  ];
}

async function actionCheck(root: string): Promise<DoctorItem[]> {
  const workflow = await findBoardReadyWorkflow(root);
  if (!workflow) {
    return [
      item("warn", "No .github/workflows/boardreadyops.yml workflow found.", {
        recommendation: "Add the BoardReadyOps GitHub Action workflow for pull request preflight.",
        messageKey: "doctor.action.noWorkflow",
        recommendationKey: "doctor.recommendation.action.noWorkflow",
      }),
    ];
  }
  let document: unknown;
  try {
    document = yaml.load(await readTextFile(workflow.path)) ?? {};
  } catch {
    return [
      item("warn", `Unable to read or parse ${workflow.relativePath} workflow.`, {
        recommendation: "Fix the BoardReadyOps workflow YAML before relying on action diagnostics.",
        messageKey: "doctor.action.workflowUnreadable",
        messageParams: { path: workflow.relativePath },
        recommendationKey: "doctor.recommendation.action.workflowYaml",
      }),
    ];
  }
  return [
    item("pass", `${workflow.relativePath} found.`, {
      messageKey: "doctor.action.workflowFound",
      messageParams: { path: workflow.relativePath },
    }),
    checkoutPinnedItem(document),
    hasPullRequestCommentPermission(document)
      ? item("pass", "permissions: pull-requests or issues write configured.", {
          messageKey: "doctor.action.permissionsConfigured",
        })
      : item("warn", "permissions: pull-requests or issues write missing for PR comments.", {
          recommendation:
            "Add `permissions: { pull-requests: write }` or `permissions: { issues: write }` to the BoardReadyOps job.",
          messageKey: "doctor.action.permissionsMissing",
          recommendationKey: "doctor.recommendation.action.permissions",
        }),
  ];
}

function checkoutPinnedItem(workflow: unknown): DoctorItem {
  const checkoutUses = workflowUses(workflow).filter(isCheckoutUse);
  if (checkoutUses.length > 0 && checkoutUses.every(isPinnedCheckoutUse)) {
    return item("pass", "actions/checkout is SHA-pinned.", { messageKey: "doctor.action.checkoutPinned" });
  }
  return item("warn", "actions/checkout is not SHA-pinned.", {
    recommendation: "Pin actions/checkout to an immutable commit SHA.",
    messageKey: "doctor.action.checkoutUnpinned",
    recommendationKey: "doctor.recommendation.action.pinCheckout",
  });
}

export function supportsDoctorNodeVersion(version: string): boolean {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  return Number.isInteger(major) && supportedNodeMajors.has(major);
}

function parseDoctorFormat(format: string | undefined): "text" | "json" {
  const candidate = format ?? "text";
  if (candidate === "text" || candidate === "json") {
    return candidate;
  }
  throw new Error(t("doctor.error.unknownFormat", { format: candidate }));
}

function parseDoctorCheck(check: string | undefined): DoctorCheckName | undefined {
  if (!check) {
    return undefined;
  }
  if (isDoctorCheckName(check)) {
    return check;
  }
  throw new Error(t("doctor.error.unknownCheck", { check, checks: doctorChecks.join(", ") }));
}

function isDoctorCheckName(value: string): value is DoctorCheckName {
  return doctorChecks.some((check) => check === value);
}

function item(
  severity: DoctorSeverity,
  message: string,
  options: {
    recommendation?: string | undefined;
    messageKey?: MessageKey | undefined;
    messageParams?: MessageParams | undefined;
    recommendationKey?: MessageKey | undefined;
    recommendationParams?: MessageParams | undefined;
  } = {},
): DoctorItem {
  return {
    severity,
    message,
    recommendation: options.recommendation,
    messageKey: options.messageKey,
    messageParams: options.messageParams,
    recommendationKey: options.recommendationKey,
    recommendationParams: options.recommendationParams,
  };
}

function collectRecommendations(checks: DoctorCheck[]): string[] {
  return [
    ...new Set(
      checks.flatMap((check) => check.items.flatMap((entry) => (entry.recommendation ? [entry.recommendation] : []))),
    ),
  ];
}

function publicDoctorReport(report: DoctorReport): DoctorReport {
  return {
    ...report,
    checks: report.checks.map((check) => ({
      ...check,
      items: check.items.map((entry) => ({
        severity: entry.severity,
        message: entry.message,
        ...(entry.recommendation ? { recommendation: entry.recommendation } : {}),
      })),
    })),
  };
}

function renderItem(entry: DoctorItem, locale: Locale): string {
  return `[${t(severityKey(entry.severity), {}, locale)}] ${localizedMessage(entry, locale)}`;
}

function localizedMessage(entry: DoctorItem, locale: Locale): string {
  return entry.messageKey
    ? t(entry.messageKey, localizedDoctorParams(entry.messageKey, entry.messageParams, locale), locale)
    : entry.message;
}

function localizedRecommendation(entry: DoctorItem, locale: Locale): string | undefined {
  if (entry.recommendationKey) {
    return t(entry.recommendationKey, entry.recommendationParams ?? {}, locale);
  }
  return entry.recommendation;
}

function collectLocalizedRecommendations(checks: DoctorCheck[], locale: Locale): string[] {
  return [
    ...new Set(
      checks.flatMap((check) =>
        check.items.flatMap((entry) => {
          const recommendation = localizedRecommendation(entry, locale);
          return recommendation ? [recommendation] : [];
        }),
      ),
    ),
  ];
}

function localizedDoctorParams(key: MessageKey, params: MessageParams | undefined, locale: Locale): MessageParams {
  const values: MessageParams = { ...(params ?? {}) };
  if (key === "doctor.repository.projectsDiscovered" && typeof values.count === "number") {
    values.projectWord =
      values.count === 1
        ? t("doctor.repository.project.word", {}, locale)
        : t("doctor.repository.project.word.plural", {}, locale);
  }
  if (key === "doctor.repository.gerbersDiscovered" && typeof values.count === "number") {
    values.outputWord =
      values.count === 1
        ? t("doctor.repository.gerberOutput.word", {}, locale)
        : t("doctor.repository.gerberOutput.word.plural", {}, locale);
  }
  return values;
}

function localizedCheckTitle(name: DoctorCheckName, locale: Locale): string {
  switch (name) {
    case "runtime":
      return t("doctor.check.runtime", {}, locale);
    case "kicad":
      return t("doctor.check.kicad", {}, locale);
    case "adapters":
      return t("doctor.check.adapters", {}, locale);
    case "repository":
      return t("doctor.check.repository", {}, locale);
    case "suppressions":
      return t("doctor.check.suppressions", {}, locale);
    case "action":
      return t("doctor.check.action", {}, locale);
  }
}

function severityKey(severity: DoctorSeverity): MessageKey {
  switch (severity) {
    case "pass":
      return "doctor.severity.pass";
    case "warn":
      return "doctor.severity.warn";
    case "fail":
      return "doctor.severity.fail";
    case "info":
      return "doctor.severity.info";
  }
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
