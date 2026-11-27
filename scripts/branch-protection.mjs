import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const repository = "oaslananka/boardreadyops";
const ownerId = 285490571;
const endpoint = `repos/${repository}`;
const rulesetsEndpoint = `${endpoint}/rulesets?includes_parents=false&per_page=100`;
const rulesetName = "main-standard";

function protectionFields(value) {
  return {
    name: value.name,
    target: value.target,
    enforcement: value.enforcement,
    conditions: value.conditions,
    rules: value.rules,
    bypass_actors: value.bypass_actors,
  };
}

function assertOwnedRule(value) {
  if (
    value.source_type !== "Repository" ||
    value.source !== repository ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0
  ) {
    throw new Error("Ruleset identity is not an owned repository ruleset.");
  }
}

function findLiveRule(api) {
  const pages = api(rulesetsEndpoint);
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error("Cannot determine complete ruleset inventory.");
  }
  const branchRules = pages.flat().filter((rule) => rule.target === "branch");
  const rule = branchRules[0];
  if (branchRules.length !== 1 || rule.name !== rulesetName) {
    throw new Error(
      "Expected one main-standard branch ruleset; resolve missing, legacy, or duplicate rulesets manually.",
    );
  }
  assertOwnedRule(rule);
  const live = api(`${endpoint}/rulesets/${rule.id}`);
  assertOwnedRule(live);
  if (live.id !== rule.id) throw new Error("Ruleset identity changed during inspection.");
  return live;
}

function assertRepository(repo) {
  const identity = {
    full_name: repo.full_name,
    owner: { login: repo.owner?.login, id: repo.owner?.id, type: repo.owner?.type },
    archived: repo.archived,
  };
  const expected = {
    full_name: repository,
    owner: { login: "oaslananka", id: ownerId, type: "User" },
    archived: false,
  };
  if (!isDeepStrictEqual(identity, expected) || !repo.default_branch) {
    throw new Error("Unexpected repository identity or lifecycle state.");
  }
}

function committedProtection(desired) {
  const expected = protectionFields(desired);
  const { rules, ...identity } = expected;
  const contract = {
    name: rulesetName,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [{ actor_id: ownerId, actor_type: "User", bypass_mode: "pull_request" }],
  };
  if (!isDeepStrictEqual(identity, contract) || !Array.isArray(rules)) {
    throw new Error("Committed ruleset does not satisfy the owner-specific contract.");
  }
  return expected;
}

function assertSoleKnownDrift(expected, actual) {
  // Keep the stronger source policy; any other difference requires manual review.
  const previous = structuredClone(expected);
  const review = previous.rules.find((rule) => rule.type === "pull_request");
  if (review?.parameters?.dismiss_stale_reviews_on_push !== true) {
    throw new Error("Committed stale-review protection must remain enabled.");
  }
  review.parameters.dismiss_stale_reviews_on_push = false;
  if (!isDeepStrictEqual(actual, previous)) {
    throw new Error(
      "Unexpected protection drift; refusing to overwrite live settings. Compare the committed JSON with the live ruleset.",
    );
  }
}

function assertCurrentRule(api, id, expected, message) {
  const current = findLiveRule(api);
  if (current.id !== id || !isDeepStrictEqual(protectionFields(current), expected)) {
    throw new Error(message);
  }
}

// This helper is intentionally limited to an established, owner-specific repo.
// Do not create rulesets or replace unrecognized live protections automatically.
export function reconcileBranchProtection(desired, api, apply = false) {
  assertRepository(api(endpoint));
  const expected = committedProtection(desired);
  const live = findLiveRule(api);
  const actual = structuredClone(protectionFields(live));
  if (isDeepStrictEqual(actual, expected)) return "aligned";
  assertSoleKnownDrift(expected, actual);
  if (!apply) return "stale-review-drift";

  assertCurrentRule(api, live.id, actual, "Ruleset changed during inspection; no update performed.");
  api(`${endpoint}/rulesets/${live.id}`, expected);
  assertCurrentRule(api, live.id, expected, "Updated ruleset could not be verified; inspect GitHub before retrying.");
  return "updated";
}

function defaultGithubExecutable() {
  const candidates =
    process.platform === "win32"
      ? ["C:/Program Files/GitHub CLI/gh.exe"]
      : ["/usr/bin/gh", "/usr/local/bin/gh", "/opt/homebrew/bin/gh"];
  return candidates.find((candidate) => existsSync(candidate));
}

// The operator may explicitly select a trusted local installation. Never
// search PATH, the working directory, or a repository-provided executable.
export function resolveGithubExecutable(candidate = process.env.BOARDREADYOPS_GH_PATH ?? defaultGithubExecutable()) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error("Set BOARDREADYOPS_GH_PATH to an absolute path to a trusted GitHub CLI installation.");
  }
  // Use the native filesystem spelling, including Windows short-name aliases.
  const executable = realpathSync.native(candidate);
  const expectedName = process.platform === "win32" ? "gh.exe" : "gh";
  if (path.basename(executable).toLowerCase() !== expectedName || !statSync(executable).isFile()) {
    throw new Error("Expected an absolute GitHub CLI executable file.");
  }
  const repoRoot = realpathSync.native(fileURLToPath(new URL("..", import.meta.url)));
  const relative = path.relative(repoRoot, executable);
  if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) {
    throw new Error("GitHub CLI must be installed outside the repository.");
  }
  return executable;
}

function githubApi(executable, resource, body) {
  const args = ["api", "--hostname", "github.com"];
  if (resource === rulesetsEndpoint) args.push("--paginate", "--slurp");
  if (body !== undefined) args.push("--method", "PUT", "--input", "-");
  args.push(resource);
  return JSON.parse(
    execFileSync(executable, args, {
      encoding: "utf8",
      ...(body === undefined ? {} : { input: JSON.stringify(body) }),
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    }),
  );
}

function main(args) {
  const apply = args.includes("--apply");
  const positional = args.filter((arg) => arg !== "--apply");
  if (
    args.filter((arg) => arg === "--apply").length > 1 ||
    positional.length > 2 ||
    (positional[0] ?? repository) !== repository ||
    (positional[1] ?? rulesetName) !== rulesetName
  ) {
    throw new Error("Usage: scripts/setup-branch-protection.sh [oaslananka/boardreadyops [main-standard]] [--apply]");
  }
  const desired = JSON.parse(readFileSync(new URL("../.github/rulesets/main.json", import.meta.url), "utf8"));
  const executable = resolveGithubExecutable();
  const result = reconcileBranchProtection(desired, (resource, body) => githubApi(executable, resource, body), apply);
  if (result === "stale-review-drift") {
    process.stderr.write(
      "Live stale-review dismissal is disabled; the committed policy requires it. No changes made. Use --apply only after reviewing the change.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      result === "aligned" ? "main-standard matches committed protection.\n" : "main-standard updated and verified.\n",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
