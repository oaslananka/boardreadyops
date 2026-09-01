import { existsSync } from "node:fs";

export const executionStatusIds = Object.freeze(
  Array.from({ length: 37 }, (_, index) => `W${String(index).padStart(2, "0")}`),
);

const statuses = new Set(["implemented", "partial", "missing", "blocked", "deferred"]);
const priorities = new Set(["P0", "P1", "P2", "P3"]);
const verificationResults = new Set(["pass", "fail", "not_run"]);
const evidenceKeys = ["code", "tests", "docs", "deployed", "commits", "pullRequests"];
const roadmapSource = "https://github.com/oaslananka/boardreadyops/issues/191";

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
