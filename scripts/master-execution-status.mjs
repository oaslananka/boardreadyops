import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const executionStatusIds = Object.freeze(
  Array.from({ length: 37 }, (_, index) => `W${String(index).padStart(2, "0")}`),
);

const statuses = new Set(["implemented", "partial", "missing", "blocked", "deferred"]);
const priorities = new Set(["P0", "P1", "P2", "P3"]);
const verificationResults = new Set(["pass", "fail", "not_run"]);
const evidenceKeys = ["code", "tests", "docs", "deployed", "commits", "pullRequests"];
const roadmapSource = "https://github.com/oaslananka/boardreadyops/issues/191";
const generatedStart = "<!-- master-execution-status:start -->";
const generatedEnd = "<!-- master-execution-status:end -->";

export function validateExecutionStatus(value, options = {}) {
  const ledger = recordValue(value, "execution status");
  if (ledger.version !== 1) throw new Error("execution status version must be 1");
  validateSpec(ledger.spec);
  const roadmap = validateRoadmap(ledger.roadmap);
  validateBaseline(ledger.baseline);
  if (!Array.isArray(ledger.workstreams)) throw new TypeError("workstreams must be an array");

  const byId = new Map();
  for (const rawEntry of ledger.workstreams) {
    const entry = recordValue(rawEntry, "workstream");
    const id = requiredString(entry.id, "workstream id");
    if (byId.has(id)) throw new Error(`duplicate workstream ${id}`);
    byId.set(id, entry);
  }
  for (const id of executionStatusIds) if (!byId.has(id)) throw new Error(`missing workstream ${id}`);
  for (const id of byId.keys()) if (!executionStatusIds.includes(id)) throw new Error(`unknown workstream ${id}`);

  for (const entry of ledger.workstreams) {
    validateWorkstream(entry, roadmap, byId, options.pathExists ?? existsSync);
  }
  validateDependencyGraph(byId);
  return ledger;
}

export function renderExecutionStatus(status) {
  const rows = [...status.workstreams]
    .sort(
      (left, right) =>
        left.phase - right.phase || left.priority.localeCompare(right.priority) || left.id.localeCompare(right.id),
    )
    .map((entry) =>
      [
        entry.id,
        entry.name,
        entry.priority,
        String(entry.phase),
        entry.status,
        entry.owner,
        entry.dependencies.join(", ") || "—",
        entry.milestone,
      ]
        .map(markdownCell)
        .join(" | "),
    )
    .map((row) => `| ${row} |`);

  return [
    "| Workstream | Name | Priority | Phase | Status | Owner | Dependencies | Roadmap target |",
    "| --- | --- | --- | ---: | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export function replaceExecutionStatusSection(document, rendered) {
  const start = document.indexOf(generatedStart);
  const end = document.indexOf(generatedEnd);
  const duplicateStart = start >= 0 && document.indexOf(generatedStart, start + generatedStart.length) >= 0;
  const duplicateEnd = end >= 0 && document.indexOf(generatedEnd, end + generatedEnd.length) >= 0;
  if (start < 0 || end < start || duplicateStart || duplicateEnd) {
    throw new Error("generated execution status markers missing or duplicated");
  }
  const contentStart = start + generatedStart.length;
  return `${document.slice(0, contentStart)}\n${rendered.trim()}\n${document.slice(end)}`;
}

const detailStatusLabels = {
  implemented: "Implemented",
  partial: "Partial",
  missing: "Missing",
  blocked: "Blocked",
  deferred: "Deferred / Moat",
};

export function validateExecutionDetailsSection(document, status) {
  const byId = new Map(status.workstreams.map((entry) => [entry.id, entry]));
  const seen = new Set();
  const headerRe = /^### (W\d{2}) —/;
  const statusRe = /^- \*\*Status:\*\* `([^`]+)`$/;
  let currentId = null;
  for (const line of document.split("\n")) {
    const headerMatch = line.match(headerRe);
    if (headerMatch) currentId = headerMatch[1];
    const statusMatch = currentId && line.match(statusRe);
    if (!statusMatch) continue;
    const entry = byId.get(currentId);
    if (!entry) throw new Error(`execution status details: unknown workstream ${currentId}`);
    const expected = detailStatusLabels[entry.status];
    if (statusMatch[1] !== expected) {
      throw new Error(
        `execution status details drift: ${currentId} Section 3 says "${statusMatch[1]}" but the ledger says "${expected}" (run corepack pnpm run execution-status:render and reconcile Section 3 by hand)`,
      );
    }
    seen.add(currentId);
  }
  for (const id of executionStatusIds) {
    if (!seen.has(id)) throw new Error(`execution status details: missing Section 3 entry for ${id}`);
  }
}

export async function main(root = process.cwd(), args = process.argv.slice(2)) {
  const mode = args[0];
  if (mode !== "render" && mode !== "check") throw new Error("expected render or check mode");
  const dataPath = join(root, "docs", "development", "master-execution-status.json");
  const documentPath = join(root, "docs", "development", "master-execution-status.md");
  const status = validateExecutionStatus(JSON.parse(await readFile(dataPath, "utf8")), {
    pathExists: (path) => existsSync(join(root, path)),
  });
  const document = await readFile(documentPath, "utf8");
  validateExecutionDetailsSection(document, status);
  const next = replaceExecutionStatusSection(document, renderExecutionStatus(status));
  if (mode === "check") {
    if (next !== document) {
      throw new Error("master execution status drift; run corepack pnpm run execution-status:render");
    }
    return;
  }
  await writeFile(documentPath, next, "utf8");
}

function validateSpec(value) {
  const spec = recordValue(value, "spec");
  requiredString(spec.path, "spec path");
  const digest = requiredString(spec.sha256, "spec sha256");
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("spec sha256 must be lowercase hex");
}

function validateRoadmap(value) {
  const roadmap = recordValue(value, "roadmap");
  if (roadmap.source !== roadmapSource) throw new Error("roadmap source must be issue #191");
  validateTimestamp(roadmap.checkedAt, "roadmap checkedAt");
  const ordered = stringArray(roadmap.orderedMilestones, "roadmap orderedMilestones");
  if (ordered.length === 0) throw new Error("roadmap milestone order missing");
  stringArray(roadmap.completedMilestones, "roadmap completedMilestones");
  return roadmap;
}

function validateBaseline(value) {
  const baseline = recordValue(value, "baseline");
  requiredString(baseline.command, "baseline command");
  requiredString(baseline.commit, "baseline commit");
  validateTimestamp(baseline.checkedAt, "baseline checkedAt");
  if (!verificationResults.has(baseline.result)) throw new Error("baseline result invalid");
  stringArray(baseline.blockers, "baseline blockers");
}

function validateWorkstream(rawEntry, roadmap, byId, pathExists) {
  const entry = recordValue(rawEntry, "workstream");
  const id = requiredString(entry.id, "workstream id");
  if (!executionStatusIds.includes(id)) throw new Error(`unknown workstream ${id}`);
  requiredString(entry.name, `${id} name`);
  if (!Number.isInteger(entry.phase) || entry.phase < 0 || entry.phase > 8) throw new Error(`${id} phase invalid`);
  if (!priorities.has(entry.priority)) throw new Error(`${id} priority invalid`);
  if (!statuses.has(entry.status)) throw new Error(`${id} status invalid`);
  requiredString(entry.owner, `${id} owner`);
  requiredString(entry.milestone, `${id} milestone`);

  const dependencies = stringArray(entry.dependencies, `${id} dependencies`);
  for (const dependency of dependencies) {
    if (dependency === id) throw new Error(`${id} cannot depend on itself`);
    const target = byId.get(dependency);
    if (!target) throw new Error(`${id} dependency missing: ${dependency}`);
    if (target.phase > entry.phase) throw new Error(`${id} scheduled before dependency ${dependency}`);
  }

  if (!Array.isArray(entry.issues) || entry.issues.some((issue) => !Number.isSafeInteger(issue) || issue <= 0)) {
    throw new Error(`${id} issues invalid`);
  }
  if (roadmap.completedMilestones.includes(entry.milestone) && entry.status !== "implemented") {
    throw new Error(`${id} targets completed milestone ${entry.milestone}`);
  }

  const evidence = recordValue(entry.evidence, `${id} evidence`);
  for (const key of evidenceKeys) stringArray(evidence[key], `${id} evidence.${key}`);
  for (const path of [...evidence.code, ...evidence.tests, ...evidence.docs]) {
    if (!pathExists(path)) throw new Error(`${id} evidence path missing: ${path}`);
  }

  const verification = recordValue(entry.verification, `${id} verification`);
  requiredString(verification.command, `${id} verification command`);
  validateTimestamp(verification.checkedAt, `${id} verification checkedAt`);
  if (!verificationResults.has(verification.result)) throw new Error(`${id} verification invalid`);

  if (entry.status === "implemented") {
    const changeEvidence = evidence.commits.length + evidence.pullRequests.length > 0;
    const complete =
      evidence.code.length > 0 &&
      evidence.tests.length > 0 &&
      evidence.docs.length > 0 &&
      evidence.deployed.length > 0 &&
      changeEvidence &&
      verification.result === "pass";
    if (!complete) throw new Error(`${id} implemented evidence missing`);
  } else if (entry.status === "deferred") {
    requiredString(entry.deferUntil, `${id} defer trigger`);
  } else {
    requiredString(entry.remaining, `${id} remaining work`);
  }
}

function validateDependencyGraph(byId) {
  const visited = new Set();
  const active = [];

  function visit(id) {
    const cycleStart = active.indexOf(id);
    if (cycleStart >= 0) throw new Error(`dependency cycle: ${[...active.slice(cycleStart), id].join(" -> ")}`);
    if (visited.has(id)) return;
    active.push(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    active.pop();
    visited.add(id);
  }

  for (const id of executionStatusIds) visit(id);
}

function recordValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} missing`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}

function validateTimestamp(value, label) {
  const timestamp = requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${label} must be UTC ISO-8601`);
  }
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ").trim();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "master execution status failed"}\n`);
    process.exitCode = 1;
  }
}
