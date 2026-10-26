import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = fs.readFileSync(path.resolve("scripts/install-playwright-ci.sh"), "utf8");
const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function runInstall(source: string, failure = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-playwright-apt-"));
  tempRoots.push(root);
  const fakeSource = path.join(root, "microsoft-prod.list");
  const stubBin = path.join(root, "bin");
  fs.mkdirSync(stubBin);
  fs.writeFileSync(fakeSource, source);
  const fakeScript = path.join(root, "install.sh");
  fs.writeFileSync(
    fakeScript,
    script.replace(
      "source_list=/etc/apt/sources.list.d/microsoft-prod.list",
      `source_list=${JSON.stringify(fakeSource)}`,
    ),
  );
  fs.writeFileSync(path.join(stubBin, "sudo"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(stubBin, "corepack"),
    '#!/bin/sh\nprintf "%s\\n" "$*"\nif [ "$EXPECT_MASK" = yes ] && [ -e "$FAKE_SOURCE" ]; then exit 38; fi\nif [ "$FAIL_INSTALL" = yes ]; then exit 27; fi\n',
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [fakeScript, "chromium"], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      RUNNER_OS: "Linux",
      RUNNER_TEMP: root,
      PATH: `${stubBin}:${process.env.PATH ?? ""}`,
      FAKE_SOURCE: fakeSource,
      EXPECT_MASK: source.includes("packages.microsoft.com/ubuntu/24.04/prod") ? "yes" : "no",
      FAIL_INSTALL: failure ? "yes" : "no",
    },
  });
  return { result, restored: fs.readFileSync(fakeSource, "utf8"), source };
}

describe("CI Playwright APT source isolation", () => {
  it("isolates only the unrelated Microsoft source during Chromium setup, then restores it", () => {
    const execution = runInstall("deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n");
    expect(execution.result.status, execution.result.stderr).toBe(0);
    expect(execution.result.stdout).toContain("pnpm exec playwright install --with-deps chromium");
    expect(execution.restored).toBe(execution.source);
  });

  it("preserves the source list even when browser installation fails", () => {
    const execution = runInstall("deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n", true);
    expect(execution.result.status).toBe(27);
    expect(execution.restored).toBe(execution.source);
  });

  it("does not alter unrelated apt sources", () => {
    const execution = runInstall("deb https://example.test/ubuntu noble main\n");
    expect(execution.result.status, execution.result.stderr).toBe(0);
    expect(execution.result.stdout).not.toContain("Isolated unrelated Microsoft");
    expect(execution.restored).toBe(execution.source);
  });
});
