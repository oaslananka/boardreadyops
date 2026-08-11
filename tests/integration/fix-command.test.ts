import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { formatFixPlan, isGitWorktreeDirty } from "../../src/cli/fixes.js";
import { runCli } from "../../src/cli/index.js";
import { runPipeline } from "../../src/core/pipeline.js";
import { isolatedGitEnvironment } from "../helpers/git-environment.js";

const execFileAsync = promisify(execFile);

describe("fix command", () => {
  it("prints a human-readable diff in dry-run mode without writing files", async () => {
    const root = await writeFixableWorkspace();
    const beforeBom = await fs.readFile(path.join(root, "bom.csv"), "utf8");
    const beforeBoard = await fs.readFile(path.join(root, "fix.kicad_pcb"), "utf8");
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--dry-run"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Planned fixes");
    expect(streams.stdoutText()).toContain("bom.missing-mpn");
    expect(streams.stdoutText()).toContain("release.version-format");
    expect(streams.stdoutText()).toContain("release.changelog-present");
    expect(streams.stdoutText()).toContain("manufacturing.fab-notes");
    expect(streams.stdoutText()).toContain("bom.dnp-consistency");
    expect(streams.stdoutText()).toContain("not automatically applied");
    expect(streams.stdoutText()).toContain("--- bom.csv");
    expect(streams.stdoutText()).toContain("+++ bom.csv");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toBe(beforeBom);
    await expect(fs.readFile(path.join(root, "fix.kicad_pcb"), "utf8")).resolves.toBe(beforeBoard);
    await expect(fs.stat(path.join(root, "CHANGELOG.md"))).rejects.toThrow();
  });

  it("keeps fix-plan ordering non-mutating", async () => {
    const source = await fs.readFile("src/cli/fixes.ts", "utf8");
    expect(source.match(/\.toSorted\(/g)).toHaveLength(3);
    expect(source).not.toContain("plan.changes.sort(");
    expect(source).not.toContain("plan.skipped.sort(");
    expect(source).not.toContain("plan.drcSuggestions.sort(");
  });

  it("keeps unchanged diff lines aligned around insertions", () => {
    const output = formatFixPlan({
      changes: [
        {
          ruleIds: ["release.changelog-present"],
          path: "CHANGELOG.md",
          before: "# Changelog\n\n## 1.0.0\n\n- Existing entry.\n",
          after: "# Changelog\n\n## 1.1.0\n\n- Added entry.\n\n## 1.0.0\n\n- Existing entry.\n",
          summary: "Insert release notes.",
        },
      ],
      skipped: [],
      drcSuggestions: [],
    });

    expect(output).toContain("@@ -1,5 +1,9 @@");
    expect(output).toContain(" ## 1.0.0\n \n - Existing entry.");
    expect(output).not.toContain("-## 1.0.0\n+- Added entry.");
  });

  it("detects dirty git state when the project root is below the repository root", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-git-"));
    await runGit(repo, ["init"]);
    const project = path.join(repo, "hardware", "board");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "untracked.txt"), "dirty\n", "utf8");

    await expect(isGitWorktreeDirty(project)).resolves.toBe(true);
  });

  it("applies allowed safe fixes and clears the fixed rule categories on rerun", async () => {
    const root = await writeFixableWorkspace();
    const streams = captureStreams();

    expect(await runCli(["fix", root], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Applied 5 fixes");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toContain(
      "R1,10k,RC0603FR-0710KL,RC0603FR-0710KL",
    );
    await expect(fs.readFile(path.join(root, "fix.kicad_pcb"), "utf8")).resolves.toContain('(rev "0.1.0")');
    await expect(fs.readFile(path.join(root, "fix.kicad_sch"), "utf8")).resolves.toContain('(rev "1.2.3")');
    await expect(fs.readFile(path.join(root, "CHANGELOG.md"), "utf8")).resolves.toContain("## 0.1.0");
    await expect(fs.readFile(path.join(root, "fab", "README.md"), "utf8")).resolves.toContain("Fabrication Notes");

    const result = await runPipeline({
      path: root,
      rules: [
        "bom.missing-mpn",
        "release.version-format",
        "release.revision-set",
        "release.changelog-present",
        "manufacturing.fab-notes",
      ],
      failOn: "never",
    });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([]);
  });

  it("honors --rule by applying only the selected rule fix", async () => {
    const root = await writeFixableWorkspace();
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "bom.missing-mpn"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Applied 1 fix");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toContain(
      "R1,10k,RC0603FR-0710KL,RC0603FR-0710KL",
    );
    await expect(fs.readFile(path.join(root, "fix.kicad_pcb"), "utf8")).resolves.toContain('(rev "prototype")');
    await expect(fs.stat(path.join(root, "CHANGELOG.md"))).rejects.toThrow();
  });

  it("does not apply fixes for rules disabled in config", async () => {
    const root = await writeFixableWorkspace();
    const configPath = path.join(root, "boardreadyops.yml");
    await fs.writeFile(
      configPath,
      (await fs.readFile(configPath, "utf8")).replace(
        "rules:\n",
        `rules:
  manufacturing.fab-notes:
    enabled: false
`,
      ),
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root], streams)).toBe(0);

    expect(streams.stdoutText()).not.toContain("manufacturing.fab-notes");
    await expect(fs.stat(path.join(root, "fab", "README.md"))).rejects.toThrow();
  });

  it("fixes every configured project BOM", async () => {
    const root = await writeFixableWorkspace();
    await fs.mkdir(path.join(root, "secondary"), { recursive: true });
    await fs.writeFile(path.join(root, "secondary", "secondary.kicad_pro"), "{}\n", "utf8");
    await fs.writeFile(
      path.join(root, "secondary", "bom.csv"),
      "Reference,Value,MPN,ki_part\nR9,1k,,RC0603FR-071KL\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
    bom: bom.csv
  - path: secondary
    bom: secondary/bom.csv
fix:
  allow:
    - bom.missing-mpn
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "bom.missing-mpn"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Applied 1 fix");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toContain(
      "R1,10k,RC0603FR-0710KL,RC0603FR-0710KL",
    );
    await expect(fs.readFile(path.join(root, "secondary", "bom.csv"), "utf8")).resolves.toContain("RC0603FR-071KL");
  });

  it("honors project-level rule disables when fixing configured BOMs", async () => {
    const root = await writeFixableWorkspace();
    await fs.mkdir(path.join(root, "secondary"), { recursive: true });
    await fs.writeFile(path.join(root, "secondary", "secondary.kicad_pro"), "{}\n", "utf8");
    await fs.writeFile(
      path.join(root, "secondary", "bom.csv"),
      "Reference,Value,MPN,ki_part\nR9,1k,,RC0603FR-071KL\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
    bom: bom.csv
  - path: secondary
    bom: secondary/bom.csv
    rules:
      bom.missing-mpn:
        enabled: false
fix:
  allow:
    - bom.missing-mpn
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "bom.missing-mpn"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Applied 1 fix");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toContain(
      "R1,10k,RC0603FR-0710KL,RC0603FR-0710KL",
    );
    await expect(fs.readFile(path.join(root, "secondary", "bom.csv"), "utf8")).resolves.toContain(
      "R9,1k,,RC0603FR-071KL",
    );
  });

  it("keeps project-level enables in the fix allow-list", async () => {
    const root = await writeFixableWorkspace();
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
    bom: bom.csv
    rules:
      bom.missing-mpn:
        enabled: true
fix:
  allow:
    - bom.missing-mpn
rules:
  bom.missing-mpn:
    enabled: false
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "bom.missing-mpn"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Applied 1 fix");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toContain(
      "R1,10k,RC0603FR-0710KL,RC0603FR-0710KL",
    );
  });

  it("falls back to every discovered BOM when configured project BOM paths are omitted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-autobom-"));
    await fs.writeFile(path.join(root, "main.kicad_pro"), "{}\n", "utf8");
    await fs.writeFile(path.join(root, "bom.csv"), "Reference,Value,MPN,ki_part\nR1,10k,,RC0603FR-0710KL\n", "utf8");
    await fs.mkdir(path.join(root, "secondary"), { recursive: true });
    await fs.writeFile(path.join(root, "secondary", "secondary.kicad_pro"), "{}\n", "utf8");
    await fs.writeFile(
      path.join(root, "secondary", "assembly-bom.csv"),
      "Reference,Value,MPN,ki_part\nR9,1k,,RC0603FR-071KL\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
  - path: secondary
fix:
  allow:
    - bom.missing-mpn
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "bom.missing-mpn"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("Applied 1 fix");
    await expect(fs.readFile(path.join(root, "bom.csv"), "utf8")).resolves.toContain(
      "R1,10k,RC0603FR-0710KL,RC0603FR-0710KL",
    );
    await expect(fs.readFile(path.join(root, "secondary", "assembly-bom.csv"), "utf8")).resolves.toContain(
      "R9,1k,RC0603FR-071KL,RC0603FR-071KL",
    );
  });

  it("matches auto-discovered BOMs to their nearest project context for DNP skipped findings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-autodnp-"));
    await writeProjectWithDnp(root, ".", "main", false);
    await writeProjectWithDnp(root, "secondary", "secondary", true);
    await fs.writeFile(path.join(root, "bom.csv"), "Reference,Value,DNP\nR1,10k,yes\n", "utf8");
    await fs.writeFile(path.join(root, "secondary", "assembly-bom.csv"), "Reference,Value,DNP\nR1,10k,yes\n", "utf8");
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
  - path: secondary
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--dry-run", "--rule", "bom.dnp-consistency"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("bom.dnp-consistency bom.csv:2");
    expect(streams.stdoutText()).not.toContain("secondary/assembly-bom.csv:2");
  });

  it("scopes DNP skipped findings to each project and ignores variant BOMs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-dnp-"));
    await writeProjectWithDnp(root, ".", "main", false);
    await writeProjectWithDnp(root, "secondary", "secondary", true);
    await fs.writeFile(path.join(root, "bom.csv"), "Reference,Value,DNP\nR1,10k,\n", "utf8");
    await fs.writeFile(path.join(root, "secondary", "bom.csv"), "Reference,Value,DNP\nR1,10k,yes\n", "utf8");
    await fs.writeFile(path.join(root, "variant.csv"), "Reference,Value,DNP\nR1,10k,yes\n", "utf8");
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
    bom: bom.csv
    variants:
      - name: production
        bom: variant.csv
  - path: secondary
    bom: secondary/bom.csv
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--dry-run", "--rule", "bom.dnp-consistency"], streams)).toBe(0);

    expect(streams.stdoutText()).not.toContain("bom.dnp-consistency");
    expect(streams.stdoutText()).not.toContain("variant.csv");
  });

  it("creates fab notes when any configured project keeps the rule enabled", async () => {
    const root = await writeFixableWorkspace();
    await fs.mkdir(path.join(root, "secondary"), { recursive: true });
    await fs.writeFile(path.join(root, "secondary", "secondary.kicad_pro"), "{}\n", "utf8");
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
projects:
  - path: .
    rules:
      manufacturing.fab-notes:
        enabled: false
  - path: secondary
fix:
  allow:
    - manufacturing.fab-notes
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "manufacturing.fab-notes"], streams)).toBe(0);

    await expect(fs.readFile(path.join(root, "fab", "README.md"), "utf8")).resolves.toContain("Fabrication Notes");
  });

  it("refuses to write through symlinks that escape the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-symlink-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-outside-"));
    await fs.writeFile(
      path.join(root, "boardreadyops.yml"),
      `version: 1
fix:
  allow:
    - manufacturing.fab-notes
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
      "utf8",
    );
    await fs.symlink(outside, path.join(root, "fab"), process.platform === "win32" ? "junction" : "dir");
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--rule", "manufacturing.fab-notes"], streams)).toBe(2);

    expect(streams.stderrText()).toContain("Refusing to write outside workspace");
    await expect(fs.stat(path.join(outside, "README.md"))).rejects.toThrow();
  });

  it("commits only planned fix files when --commit is used with staged changes", async () => {
    const root = await writeFixableWorkspace();
    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "boardreadyops@example.invalid"]);
    await runGit(root, ["config", "user.name", "BoardReadyOps Test"]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "initial"]);
    await fs.writeFile(path.join(root, "unrelated.txt"), "pre-staged\n", "utf8");
    await runGit(root, ["add", "unrelated.txt"]);
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--allow-dirty", "--commit"], streams)).toBe(0);

    const committed = await runGitOutput(root, ["show", "--name-only", "--format=", "HEAD"]);
    expect(committed.stdout).toContain("bom.csv");
    expect(committed.stdout).not.toContain("unrelated.txt");
    const staged = await runGitOutput(root, ["diff", "--cached", "--name-only"]);
    expect(staged.stdout).toContain("unrelated.txt");
  });

  it("prints KiCad DRC report suggestions without mutating the board file", async () => {
    const root = await writeFixableWorkspace();
    const drcReport = path.join(root, "drc.json");
    await fs.writeFile(
      drcReport,
      JSON.stringify({
        violations: [
          {
            rule: "clearance",
            severity: "error",
            message: "increase clearance between track and pad to 0.25 mm",
            file: "fix.kicad_pcb",
            line: 3,
            column: 5,
            suggestedFix: "Increase the board setup clearance to 0.25 mm.",
          },
        ],
      }),
      "utf8",
    );
    const beforeBoard = await fs.readFile(path.join(root, "fix.kicad_pcb"), "utf8");
    const streams = captureStreams();

    expect(await runCli(["fix", root, "--dry-run", "--drc-report", "drc.json"], streams)).toBe(0);

    expect(streams.stdoutText()).toContain("DRC suggested fixes");
    expect(streams.stdoutText()).toContain("drc.clearance");
    expect(streams.stdoutText()).toContain("fix.kicad_pcb:3");
    expect(streams.stdoutText()).toContain("Increase the board setup clearance to 0.25 mm.");
    await expect(fs.readFile(path.join(root, "fix.kicad_pcb"), "utf8")).resolves.toBe(beforeBoard);
  });
});

async function writeFixableWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fix-"));
  await fs.writeFile(path.join(root, "fix.kicad_pro"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(root, "fix.kicad_pcb"),
    `(kicad_pcb
  (title_block (rev "prototype"))
  (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (property "Reference" "R1"))
  (footprint "LED_SMD:LED_0603" (layer "F.Cu") (property "Reference" "R3"))
)
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "fix.kicad_sch"),
    `(kicad_sch
  (title_block (rev "release-1.2.3"))
  (symbol (property "Reference" "R1") (property "Value" "10k") (property "MPN" "RC0603FR-0710KL"))
)
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "bom.csv"),
    "Reference,Value,MPN,ki_part,DNP\nR1,10k,,RC0603FR-0710KL,\nR3,LED,LED0603-RED,,yes\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "boardreadyops.yml"),
    `version: 1
projects:
  - path: .
    bom: bom.csv
fix:
  allow:
    - bom.missing-mpn
    - release.changelog-present
    - release.version-format
    - release.revision-set
    - manufacturing.fab-notes
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
fail-on: never
`,
    "utf8",
  );
  return root;
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: {
      write(value: string) {
        stdout += value;
        return true;
      },
    },
    stderr: {
      write(value: string) {
        stderr += value;
        return true;
      },
    },
    stdoutText() {
      return stdout;
    },
    stderrText() {
      return stderr;
    },
  } as unknown as {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    stdoutText(): string;
    stderrText(): string;
  };
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await runGitOutput(cwd, args);
}

async function runGitOutput(cwd: string, args: string[]) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: isolatedGitEnvironment(),
    timeout: 30_000,
  });
}

async function writeProjectWithDnp(root: string, relativePath: string, name: string, dnp: boolean): Promise<void> {
  const projectRoot = path.join(root, relativePath);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, `${name}.kicad_pro`), "{}\n", "utf8");
  await fs.writeFile(
    path.join(projectRoot, `${name}.kicad_pcb`),
    `(kicad_pcb
  (footprint "Resistor_SMD:R_0603" (property "Reference" "R1")${dnp ? " (attr smd dnp)" : ""})
)
`,
    "utf8",
  );
}
