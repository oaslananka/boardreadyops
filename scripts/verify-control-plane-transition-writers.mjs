import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runtimeExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

export const protectedFunctionOwners = Object.freeze({
  boardreadyops_transition_release_run_state: "0023_versioned_release_run_transitions.sql",
  boardreadyops_complete_workflow_dispatch_effect: "0024_guarded_workflow_dispatch_transition.sql",
  boardreadyops_complete_check_run_create_effect: "0025_guarded_check_run_create_transition.sql",
  boardreadyops_apply_github_workflow_reconciliation: "0026_guarded_workflow_reconciliation_transition.sql",
  boardreadyops_supersede_release_run_state: "0027_guarded_release_run_supersession.sql",
  boardreadyops_enqueue_release_run_with_outbox: "0027_guarded_release_run_supersession.sql",
  boardreadyops_apply_runner_result_state: "0028_guarded_runner_result_transition.sql",
  boardreadyops_expire_runner_leases: "0029_guarded_runner_lease_transitions.sql",
  boardreadyops_claim_runner_job: "0029_guarded_runner_lease_transitions.sql",
  boardreadyops_heartbeat_runner_lease: "0029_guarded_runner_lease_transitions.sql",
  boardreadyops_relinquish_runner_lease: "0029_guarded_runner_lease_transitions.sql",
});

const runtimeWriterPatterns = [
  {
    reason: "release_runs status",
    pattern: /update\s+(?:public\.)?release_runs\b[\s\S]{0,2000}?\bset\b[\s\S]{0,1000}?\bstatus\s*=/iu,
  },
  {
    reason: "release_runs current-attempt pointer",
    pattern: /update\s+(?:public\.)?release_runs\b[\s\S]{0,2000}?\bset\b[\s\S]{0,1000}?\bexecution_attempt_id\s*=/iu,
  },
  {
    reason: "release_run_attempts status",
    pattern: /update\s+(?:public\.)?release_run_attempts\b[\s\S]{0,2000}?\bset\b[\s\S]{0,1000}?\bstatus\s*=/iu,
  },
  {
    reason: "release_run_attempts insert",
    pattern: /insert\s+into\s+(?:public\.)?release_run_attempts\b/iu,
  },
  {
    reason: "retired SQL lifecycle factory",
    pattern: new RegExp(["createSqlGitHubApp", "LifecycleStore"].join(""), "u"),
  },
];

function normalizedPath(value) {
  return String(value).replaceAll("\\", "/");
}

function sortedSources(files) {
  return [...files].sort((left, right) => normalizedPath(left.path).localeCompare(normalizedPath(right.path)));
}

export function findRuntimeTransitionWriterViolations(files) {
  return sortedSources(files).flatMap((file) => {
    const path = normalizedPath(file.path);
    return runtimeWriterPatterns.flatMap(({ reason, pattern }) =>
      pattern.test(file.content) ? [`${path}: ${reason}`] : [],
    );
  });
}

export function latestProtectedFunctionDefinitions(migrationFiles) {
  const latest = {};
  const functionPattern = /create\s+or\s+replace\s+function\s+(?:public\.)?(boardreadyops_[a-z0-9_]+)\s*\(/giu;

  for (const file of sortedSources(migrationFiles)) {
    for (const match of file.content.matchAll(functionPattern)) {
      const functionName = match[1];
      if (functionName && Object.hasOwn(protectedFunctionOwners, functionName)) {
        latest[functionName] = basename(file.path);
      }
    }
  }

  return latest;
}

export function findProtectedFunctionOwnershipViolations(migrationFiles) {
  const latest = latestProtectedFunctionDefinitions(migrationFiles);
  return Object.entries(protectedFunctionOwners).flatMap(([functionName, expectedOwner]) => {
    const actualOwner = latest[functionName];
    return actualOwner === expectedOwner
      ? []
      : [`${functionName}: expected ${expectedOwner}, found ${actualOwner ?? "missing"}`];
  });
}

export function verifyControlPlaneTransitionWriters(runtimeFiles, migrationFiles) {
  const violations = [
    ...findRuntimeTransitionWriterViolations(runtimeFiles),
    ...findProtectedFunctionOwnershipViolations(migrationFiles),
  ];
  if (violations.length > 0) {
    throw new Error(`Control-plane transition writer boundary failed: ${violations.join("; ")}`);
  }
}

async function walkFiles(root, directory) {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".next" || entry.name === "dist" || entry.name === "node_modules") {
      continue;
    }
    const childRelative = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (childRelative === "packages/db/migrations") {
        continue;
      }
      files.push(...(await walkFiles(root, childRelative)));
      continue;
    }
    if (entry.isFile() && runtimeExtensions.has(extname(entry.name))) {
      files.push({ path: normalizedPath(childRelative), content: await readFile(join(root, childRelative), "utf8") });
    }
  }

  return files;
}

async function runtimeSources(root) {
  const roots = ["apps", "packages", "src"];
  const sources = [];
  for (const directory of roots) {
    sources.push(...(await walkFiles(root, directory)));
  }
  return sources;
}

async function migrationSources(root) {
  const directory = join(root, "packages/db/migrations");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  return await Promise.all(
    names.map(async (name) => ({
      path: normalizedPath(join("packages/db/migrations", name)),
      content: await readFile(join(directory, name), "utf8"),
    })),
  );
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const runtimeFiles = await runtimeSources(root);
  const migrationFiles = await migrationSources(root);
  verifyControlPlaneTransitionWriters(runtimeFiles, migrationFiles);
  process.stdout.write(
    `${JSON.stringify({
      event: "transition_writers_verified",
      runtimeFiles: runtimeFiles.length,
      migrations: migrationFiles.length,
      protectedFunctions: Object.keys(protectedFunctionOwners).length,
    })}\n`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        event: "transition_writers_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message.slice(0, 4_000) : "Transition writer verification failed.",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
