import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const inGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }); // NOSONAR -- git is fixed; CI/developer PATH is trusted.
if (inGit.status !== 0) {
  process.exit(0);
}

const failures = [];
let trackedContentCache;
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }); // NOSONAR -- git is fixed; CI/developer PATH is trusted.
if (status.stdout.trim() !== "") {
  failures.push(`working tree is not clean:\n${status.stdout.trim()}`);
}

for (const entry of ["node_modules", "coverage", "lib", ".sonar", ".scannerwork", "sonar-project.properties"]) {
  if (hasTrackedPath(entry)) {
    failures.push(`generated artifact is tracked: ${entry}`);
  }
}

const distFiles = listFiles("dist")
  .map((file) => normalize(file))
  .sort();
const expectedDist = ["dist/action/index.cjs", "dist/cli/index.cjs"];
if (JSON.stringify(distFiles) !== JSON.stringify(expectedDist)) {
  failures.push(`dist contains unexpected files:\n${distFiles.join("\n")}`);
}

scanForbiddenContent();
scanWorkflowRuntimeContent();
scanBannedLanguage();

if (failures.length > 0) {
  throw new Error(`clean tree verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

function scanForbiddenContent() {
  const terms = [new RegExp(`board[-_]?${"gu"}${"ard"}`, "i"), new RegExp(`oaslananka-${"la"}${"b"}`)];
  for (const { file, text } of trackedContent()) {
    for (const term of terms) {
      if (term.test(text)) {
        failures.push(`forbidden content in ${file}`);
        return;
      }
    }
  }
}

function scanWorkflowRuntimeContent() {
  const terms = [
    /self-hosted/,
    /runs-on:\s*\[/,
    /::set-output/,
    /::save-state/,
    /ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION/,
  ];
  for (const file of listFiles(".github/workflows")) {
    const text = readText(file);
    for (const term of terms) {
      if (term.test(text)) {
        failures.push(`forbidden workflow content in ${file}`);
        return;
      }
    }
  }
}

function scanBannedLanguage() {
  const word = (...parts) => parts.join("");
  const phraseParts = [
    [word("be", "st"), word("i", "n"), word("cla", "ss")],
    [word("wor", "ld"), word("cla", "ss")],
    [word("indu", "stry"), word("lea", "ding")],
    [word("cut", "ting"), word("ed", "ge")],
    [word("sta", "te"), word("o", "f"), word("t", "he"), word("ar", "t")],
    [word("prin", "ciple"), word("devel", "oper")],
    [word("prin", "cipal"), word("devel", "oper")],
    [word("profes", "sional"), word("gra", "de")],
    [word("enter", "prise"), word("gra", "de")],
    [word("produc", "tion"), word("gra", "de")],
    [word("un", "leash")],
    [word("super", "charge")],
    [word("revolution", "iz")],
    [word("sky", "rocket")],
    [word("de", "light")],
    [word("a", "s"), word("yo", "u"), word("ca", "n"), word("se", "e")],
    [word("need", "less"), word("t", "o"), word("sa", "y")],
    [word("power", "ful"), word("to", "ol")],
    [word("ama", "zing")],
    [word("rob", "ust"), word("solu", "tion")],
    [word("flaw", "less")],
    [word("gener", "ated"), word("b", "y"), word("cla", "ude")],
    [word("gener", "ated"), word("b", "y"), word("g", "pt")],
    [word("gener", "ated"), word("b", "y"), word("co", "dex")],
    [word("co-auth", "ored-by:"), word("cla", "ude")],
    [word("co-auth", "ored-by:"), word("g", "pt")],
    [word("co-auth", "ored-by:"), word("co", "dex")],
  ];
  const patterns = phraseParts.map((parts) => new RegExp(parts.join("[^a-zA-Z0-9]+"), "i"));
  for (const { file, text } of trackedContent()) {
    if (normalize(file) === "NOTICE") {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        failures.push(`banned language in ${file}`);
        return;
      }
    }
  }
}

function trackedContent() {
  if (trackedContentCache) {
    return trackedContentCache;
  }

  const entries = listTrackedIndexEntries().filter(({ file }) => !ignored(file));
  const objectIds = [...new Set(entries.filter(({ mode }) => mode !== "160000").map(({ objectId }) => objectId))];
  const objects = readGitObjects(objectIds);
  trackedContentCache = entries.map(({ file, mode, objectId }) => ({
    file,
    text: mode === "160000" ? "" : (objects.get(objectId) ?? ""),
  }));
  return trackedContentCache;
}

function listTrackedIndexEntries() {
  const options = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 };
  const result = spawnSync("git", ["ls-files", "--cached", "--stage", "-z"], options); // NOSONAR -- git and its arguments are fixed; trusted developer/CI PATH resolution is intentional.
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  }

  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t");
      if (separator < 0) {
        throw new Error(`unexpected git ls-files record: ${record}`);
      }
      const [mode, objectId, stage] = record.slice(0, separator).split(" ");
      if (!mode || !objectId || stage !== "0") {
        throw new Error(`unexpected tracked index entry: ${record}`);
      }
      return { mode, objectId, file: record.slice(separator + 1) };
    });
}

function readGitObjects(objectIds) {
  if (objectIds.length === 0) {
    return new Map();
  }

  const options = { input: `${objectIds.join("\n")}\n`, maxBuffer: 256 * 1024 * 1024 };
  const result = spawnSync("git", ["cat-file", "--batch"], options); // NOSONAR -- git and its arguments are fixed; object IDs come from the trusted repository index and developer/CI PATH resolution is intentional.
  if (result.status !== 0) {
    throw new Error(`git cat-file failed: ${result.stderr.toString("utf8").trim()}`);
  }

  const objects = new Map();
  let offset = 0;
  for (const requestedObjectId of objectIds) {
    const headerEnd = result.stdout.indexOf(0x0a, offset);
    if (headerEnd < 0) {
      throw new Error(`missing git cat-file header for ${requestedObjectId}`);
    }
    const header = result.stdout.subarray(offset, headerEnd).toString("utf8");
    const match = /^([0-9a-f]+) ([a-z]+) (\d+)$/.exec(header);
    if (!match) {
      throw new Error(`unexpected git cat-file header: ${header}`);
    }
    const [, objectId, objectType, sizeText] = match;
    if (objectId !== requestedObjectId || objectType !== "blob") {
      throw new Error(`unexpected git object for ${requestedObjectId}: ${header}`);
    }

    const size = Number.parseInt(sizeText, 10);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 0x0a) {
      throw new Error(`truncated git cat-file payload for ${requestedObjectId}`);
    }
    objects.set(objectId, result.stdout.subarray(contentStart, contentEnd).toString("utf8"));
    offset = contentEnd + 1;
  }
  return objects;
}

function hasTrackedPath(entry) {
  const result = spawnSync("git", ["ls-files", "--cached", "--", entry], { encoding: "utf8" }); // NOSONAR -- git and its arguments are fixed; trusted developer/CI PATH resolution is intentional.
  return result.status === 0 && result.stdout.trim() !== "";
}

function exists(entry) {
  try {
    statSync(entry);
    return true;
  } catch {
    return false;
  }
}

function listFiles(directory) {
  if (!exists(directory)) {
    return [];
  }
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

function ignored(file) {
  const normalized = normalize(file);
  return (
    normalized.startsWith(".git/") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("coverage/") ||
    normalized.startsWith(".codex-checkpoints/")
  );
}

function normalize(file) {
  return file.replace(/\\/g, "/");
}

function readText(file) {
  return spawnSync("git", ["show", `:${normalize(file)}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout; // NOSONAR -- git is fixed and the path is normalized from tracked repository entries.
}
