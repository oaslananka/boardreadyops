#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_INTEGRATION_SUMMARY = {
  required: { status: "not-recorded", detail: "run pnpm test:int:monorepo" },
  postgres: { status: "environment-dependent", detail: "requires explicit PostgreSQL opt-in" },
  kicad: { status: "skipped", detail: "environment-dependent: requires a supported kicad-cli" },
};

function detail(entry, fallback) {
  return entry?.detail ?? fallback;
}

export function renderVerificationSummary(integration = DEFAULT_INTEGRATION_SUMMARY) {
  const rows = [
    [
      "Root verification",
      "tested",
      "lint, typecheck, build, unit/property/snapshot/action/a11y, core coverage, docs, security",
    ],
    [
      "Required integration",
      integration.required.status,
      detail(integration.required, "environment-independent suite"),
    ],
    ["Cloud workspaces", "tested", "contracts, cloud-core, db, and web typechecks plus production build"],
    ["Cloud coverage", "tested", "web, cloud-core, contracts, and db unit suites with explicit thresholds"],
    ["Web runtime", "tested", "standalone runtime smoke and worker-boundary verification"],
    ["Workflow security", "tested", "actionlint and zizmor through pinned pre-commit hooks"],
    [
      "PostgreSQL integration",
      integration.postgres.status,
      detail(integration.postgres, "requires BOARDREADYOPS_POSTGRES_TESTS=true and a disposable DATABASE_URL"),
    ],
    ["KiCad integration", integration.kicad.status, detail(integration.kicad, "requires a supported kicad-cli")],
  ];

  return [
    "## Complete monorepo verification",
    "",
    "| Surface | Status | Scope |",
    "| --- | --- | --- |",
    ...rows.map(([surface, status, scope]) => `| ${surface} | ${status} | ${scope} |`),
    "",
  ].join("\n");
}

export function readIntegrationSummary(path = ".boardreadyops/verification/integration-summary.json") {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return DEFAULT_INTEGRATION_SUMMARY;
    }
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const markdown = renderVerificationSummary(readIntegrationSummary());
  process.stdout.write(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
