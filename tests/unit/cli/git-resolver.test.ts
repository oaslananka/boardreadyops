import { describe, expect, it } from "vitest";
import { resolveGitExecutable } from "../../../src/util/git-resolver.js";

describe("Safe Git Executable Resolver (Deterministic Cross-Platform)", () => {
  it("resolves Windows Program Files git candidate deterministically", () => {
    const existing = new Set(["C:\\Program Files\\Git\\cmd\\git.exe"]);
    const resolved = resolveGitExecutable({
      platform: "win32",
      env: {},
      isRegularFile: (p) => existing.has(p),
    });
    expect(resolved).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
  });

  it("resolves Linux /usr/bin/git candidate deterministically", () => {
    const existing = new Set(["/usr/bin/git"]);
    const resolved = resolveGitExecutable({
      platform: "linux",
      env: {},
      isRegularFile: (p) => existing.has(p),
    });
    expect(resolved).toBe("/usr/bin/git");
  });

  it("resolves macOS /opt/homebrew/bin/git candidate deterministically", () => {
    const existing = new Set(["/opt/homebrew/bin/git"]);
    const resolved = resolveGitExecutable({
      platform: "darwin",
      env: {},
      isRegularFile: (p) => existing.has(p),
    });
    expect(resolved).toBe("/opt/homebrew/bin/git");
  });

  it("accepts valid explicit BOARDREADYOPS_GIT_PATH override", () => {
    const overridePath = process.platform === "win32" ? "C:\\custom\\git.exe" : "/custom/bin/git";
    const existing = new Set([overridePath]);
    const resolved = resolveGitExecutable({
      env: { BOARDREADYOPS_GIT_PATH: overridePath },
      isRegularFile: (p) => existing.has(p),
    });
    expect(resolved).toBe(overridePath);
  });

  it("rejects relative path in BOARDREADYOPS_GIT_PATH", () => {
    expect(() => {
      resolveGitExecutable({
        env: { BOARDREADYOPS_GIT_PATH: "git" },
      });
    }).toThrow(/must be an absolute path/u);

    expect(() => {
      resolveGitExecutable({
        env: { BOARDREADYOPS_GIT_PATH: "./bin/git" },
      });
    }).toThrow(/must be an absolute path/u);
  });

  it("rejects directory or non-file path in BOARDREADYOPS_GIT_PATH", () => {
    expect(() => {
      resolveGitExecutable({
        env: { BOARDREADYOPS_GIT_PATH: process.platform === "win32" ? "C:\\git_dir" : "/git_dir" },
        isRegularFile: () => false,
      });
    }).toThrow(/does not point to an existing regular file/u);
  });

  it("ignores GIT_EXEC_PATH for binary selection", () => {
    const resolved = resolveGitExecutable({
      platform: "linux",
      env: { GIT_EXEC_PATH: "/usr/lib/git-core" },
      isRegularFile: (p) => p === "/usr/bin/git",
    });
    expect(resolved).toBe("/usr/bin/git");
  });

  it("throws clear error when no candidate exists and no override is provided", () => {
    expect(() => {
      resolveGitExecutable({
        platform: "win32",
        env: {},
        isRegularFile: () => false,
      });
    }).toThrow(/Safe git executable not found in standard system locations/u);

    expect(() => {
      resolveGitExecutable({
        platform: "linux",
        env: {},
        isRegularFile: () => false,
      });
    }).toThrow(/Safe git executable not found in standard system locations/u);
  });
});
