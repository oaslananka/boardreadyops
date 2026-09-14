import { access, readFile } from "node:fs/promises";
import glob from "fast-glob";

/**
 * Checks that every link into this project's own GitHub namespace points at something real.
 *
 * Written after `docs/golden-demo.md` spent an unknown length of time describing two demo
 * repositories in the present tense, with links, that did not exist. Nothing failed: a link is
 * only text, and the one reader who would have noticed was a prospective user following it --
 * exactly the person the page was written for.
 *
 * Two kinds of link, checked two different ways, because they fail for different reasons:
 *
 *   Links into this repository (`boardreadyops/tree|blob/<ref>/<path>`) are resolved against the
 *   working tree. No network, so this half runs on every pull request, and it catches the common
 *   case: a file was renamed or deleted and the prose still points at where it used to be.
 *
 *   Links to other repositories in the namespace need the network, so that half runs only with
 *   `--remote`, on a schedule. There are few of them.
 *
 * Third-party links are deliberately out of scope. They rot for reasons outside this repository's
 * control, and a build that fails on someone else's outage teaches people to ignore the check.
 * These links are ours, so a broken one is our mistake.
 */

/** `noConsole` is enforced repository-wide; scripts here write to the streams directly. */
const out = (message) =>
  process.stdout.write(`${message}
`);
const err = (message) =>
  process.stderr.write(`${message}
`);

const ownNamespace = /https:\/\/github\.com\/oaslananka\/([\w.-]+)((?:\/[\w./#-]*[\w/-])?)/g;

const sources = ["README.md", "docs/**/*.md", "*.md"];
const ignore = ["node_modules/**", "site/**"];

const thisRepository = "boardreadyops";
const checkRemote = process.argv.includes("--remote");

/** Trailing punctuation a Markdown sentence leaves on the end of a bare URL. */
function trimPunctuation(value) {
  return value.replace(/[.,;:)\]]+$/u, "");
}

/**
 * The repository-relative path a tree/blob link points at, or undefined when the link addresses
 * something other than a file -- an issue, a release, a pull request, the repository root.
 */
function treePath(repository, rest) {
  if (repository !== thisRepository) return undefined;
  const match = /^\/(?:tree|blob)\/[^/]+\/(.+)$/u.exec(rest);
  const captured = match?.[1];
  if (!captured) return undefined;
  // Anchors address a heading inside the file; the file is what has to exist.
  return decodeURIComponent(captured.split("#")[0] ?? "");
}

async function collect() {
  const files = await glob(sources, { ignore });
  /** @type {Map<string, {repository: string, rest: string, files: Set<string>}>} */
  const byUrl = new Map();

  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(ownNamespace)) {
      const url = trimPunctuation(match[0]);
      const repository = match[1] ?? "";
      const rest = trimPunctuation(match[2] ?? "");
      const existing = byUrl.get(url);
      if (existing) {
        existing.files.add(file);
        continue;
      }
      byUrl.set(url, { repository, rest, files: new Set([file]) });
    }
  }
  return byUrl;
}

async function exists(relativePath) {
  try {
    await access(relativePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * GitHub answers 404 both for a repository that does not exist and for one private to the caller.
 * That is the right answer either way: a link a reader cannot follow is broken regardless of why.
 */
async function resolvesRemotely(url) {
  const attempt = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { method, redirect: "follow", signal: controller.signal });
      return { ok: response.ok, status: String(response.status) };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const head = await attempt("HEAD");
    // Some paths refuse HEAD, and unauthenticated rate limiting surfaces as 403. Retry rather than
    // reporting a broken link on the strength of a method restriction.
    return head.status === "405" || head.status === "403" ? await attempt("GET") : head;
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.message : "request failed" };
  }
}

const links = await collect();
const local = [];
const remote = [];

for (const [url, entry] of links) {
  const relative = treePath(entry.repository, entry.rest);
  if (relative !== undefined) {
    local.push({ url, relative, files: entry.files });
    continue;
  }
  // Only other repositories in the namespace are worth a request. Links to this repository's own
  // issues, releases and pull requests are not claims about the filesystem, and checking them
  // would mean a thousand requests to assert that GitHub still serves GitHub.
  if (entry.repository !== thisRepository) remote.push({ url, files: entry.files });
}

/** @type {{url: string, reason: string, files: Set<string>}[]} */
const broken = [];

for (const entry of local) {
  if (await exists(entry.relative)) continue;
  broken.push({ url: entry.url, reason: `no such path in this repository: ${entry.relative}`, files: entry.files });
}

out(`Resolved ${local.length} in-repository link(s) against the working tree.`);

if (checkRemote) {
  const unique = [...new Map(remote.map((entry) => [entry.url, entry])).values()];
  // Small batches: enough concurrency to finish, little enough to stay well inside unauthenticated
  // rate limits. There are a handful of these links, not a thousand.
  for (let index = 0; index < unique.length; index += 4) {
    const batch = unique.slice(index, index + 4);
    const results = await Promise.all(batch.map(async (entry) => ({ entry, ...(await resolvesRemotely(entry.url)) })));
    for (const result of results) {
      if (result.ok) continue;
      broken.push({ url: result.entry.url, reason: `unreachable (${result.status})`, files: result.entry.files });
    }
  }
  out(`Requested ${unique.length} link(s) to other repositories in the namespace.`);
} else if (remote.length > 0) {
  const names = [...new Set(remote.map((entry) => entry.url))].length;
  out(`Skipped ${names} link(s) to other repositories. Pass --remote to check those.`);
}

if (broken.length === 0) {
  out("All resolve.");
  process.exit(0);
}

err(`\n${broken.length} broken:\n`);
for (const entry of broken.sort((a, b) => a.url.localeCompare(b.url))) {
  err(`  ${entry.url}`);
  err(`      ${entry.reason}`);
  for (const file of [...entry.files].sort((a, b) => a.localeCompare(b))) err(`      referenced in ${file}`);
}
err("\nEither create what the link promises, or stop promising it.");
process.exit(1);
