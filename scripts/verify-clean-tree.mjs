import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const inGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
if (inGit.status !== 0) {
  process.exit(0);
}

const failures = [];
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
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
  const files = listFiles(".").filter((file) => !ignored(file));
  for (const file of files) {
    const text = readText(file);
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
  for (const file of listFiles(".").filter((entry) => !ignored(entry) && normalize(entry) !== "NOTICE")) {
    const text = readText(file);
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        failures.push(`banned language in ${file}`);
        return;
      }
    }
  }
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
