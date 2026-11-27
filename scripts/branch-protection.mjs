import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
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

// This helper is intentionally limited to an established, owner-specific repo.
// Do not create rulesets or replace unrecognized live protections automatically.
export function reconcileBranchProtection(desired, api, apply = false) {
  const repo = api(endpoint);
  if (
    repo.full_name !== repository ||
    repo.owner?.login !== "oaslananka" ||
    repo.owner?.id !== ownerId ||
    repo.owner?.type !== "User" ||
    repo.archived !== false ||
    !repo.default_branch
  ) {
    throw new Error("Unexpected repository identity or lifecycle state.");
  }
  const expected = protectionFields(desired);
  if (
    expected.name !== rulesetName ||
    expected.target !== "branch" ||
    expected.enforcement !== "active" ||
    !isDeepStrictEqual(expected.conditions, { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }) ||
    !isDeepStrictEqual(expected.bypass_actors, [{ actor_id: ownerId, actor_type: "User", bypass_mode: "pull_request" }])
  ) {
    throw new Error("Committed ruleset does not satisfy the owner-specific contract.");
  }
  const live = findLiveRule(api);
  const actual = structuredClone(protectionFields(live));
  if (isDeepStrictEqual(actual, expected)) return "aligned";

  // Preserve the stronger committed stale-review policy. Every other difference
  // (including missing bypass data, new requirements or changed check IDs) is
  // deliberately a manual review, never a blind replacement.
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
  if (!apply) return "stale-review-drift";

  const confirmed = findLiveRule(api);
  if (confirmed.id !== live.id || !isDeepStrictEqual(protectionFields(confirmed), actual)) {
    throw new Error("Ruleset changed during inspection; no update performed.");
  }
  api(`${endpoint}/rulesets/${live.id}`, expected);
  const updated = findLiveRule(api);
  if (updated.id !== live.id || !isDeepStrictEqual(protectionFields(updated), expected)) {
    throw new Error("Updated ruleset could not be verified; inspect GitHub before retrying.");
  }
  return "updated";
}

function githubApi(resource, body) {
  const args = ["api", "--hostname", "github.com"];
  if (resource === rulesetsEndpoint) args.push("--paginate", "--slurp");
  if (body !== undefined) args.push("--method", "PUT", "--input", "-");
  args.push(resource);
  return JSON.parse(
    execFileSync("gh", args, {
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
  const result = reconcileBranchProtection(desired, githubApi, apply);
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
