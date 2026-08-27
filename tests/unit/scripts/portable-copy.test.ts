import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { copyDirectoryPortable } from "../../../scripts/lib/portable-copy.mjs";

const temporaryRoots: string[] = [];

/**
 * Windows refuses symlink creation unless the process is elevated or Developer Mode is on.
 * Without this probe the symlink case fails for every unprivileged Windows contributor, which
 * blocks the pre-push hook while proving nothing. CI runs on Linux, where it always executes.
 */
let symlinksPermitted = true;

beforeAll(async () => {
  const probe = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-symlink-probe-"));
  temporaryRoots.push(probe);
  try {
    await mkdir(path.join(probe, "target"));
    await symlink(path.join(probe, "target"), path.join(probe, "link"), "dir");
  } catch {
    symlinksPermitted = false;
  }
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable directory copy", () => {
  it("preserves directory symlink type for pnpm-style relative targets", async ({ skip }) => {
    if (!symlinksPermitted) skip("this platform does not permit creating symlinks");

    const source = await mkdtemp(path.join(process.cwd(), ".portable-copy-directory-source-"));
    temporaryRoots.push(source);
    const packageDirectory = "next@16.2.11_@babel+core@7._be10f97c94e825087e2e0e278d75b52b";
    const target = path.join("..", "..", "..", "node_modules", ".pnpm", packageDirectory, "node_modules", "next");
    const sourceLink = path.join(source, "apps", "web", "node_modules", "next");
    await mkdir(path.dirname(sourceLink), { recursive: true });
    await mkdir(path.resolve(path.dirname(sourceLink), target), { recursive: true });
    await symlink(target, sourceLink, "dir");

    const destinationParent = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-web-standalone-regression-"));
    temporaryRoots.push(destinationParent);
    const destinationRoot = path.join(destinationParent, "runtime");
    const copiedLink = path.join(destinationRoot, "apps", "web", "node_modules", "next");

    await copyDirectoryPortable(sourceLink, copiedLink);
    const copiedTarget = path.resolve(path.dirname(copiedLink), target);
    await mkdir(copiedTarget, { recursive: true });
    await writeFile(path.join(copiedTarget, "package.json"), '{"name":"next"}\n');

    await expect(readlink(copiedLink)).resolves.toBe(target);
    expect((await lstat(copiedLink)).isSymbolicLink()).toBe(true);
    expect((await stat(copiedLink)).isDirectory()).toBe(true);
    await expect(readFile(path.join(copiedLink, "package.json"), "utf8")).resolves.toBe('{"name":"next"}\n');
  });
  it.skipIf(process.platform === "win32")(
    "copies setgid source trees without applying special permission bits",
    async ({ skip }) => {
      const source = await mkdtemp(path.join(process.cwd(), ".portable-copy-source-"));
      temporaryRoots.push(source);
      await chmod(source, 0o2700).catch(() => undefined);
      await mkdir(path.join(source, "nested"));
      await writeFile(path.join(source, "nested", "evidence.txt"), "verified\n");
      await symlink(path.join("nested", "evidence.txt"), path.join(source, "evidence-link"));

      const destinationParent = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-portable-copy-"));
      temporaryRoots.push(destinationParent);
      const destination = path.join(destinationParent, "runtime");

      const sourceMode = (await stat(source)).mode;
      skip((sourceMode & 0o2000) !== 0o2000, "filesystem does not permit setgid directories");

      await copyDirectoryPortable(source, destination);

      await expect(readFile(path.join(destination, "nested", "evidence.txt"), "utf8")).resolves.toBe("verified\n");
      await expect(readlink(path.join(destination, "evidence-link"))).resolves.toBe(
        path.join("nested", "evidence.txt"),
      );
      expect((await lstat(path.join(destination, "evidence-link"))).isSymbolicLink()).toBe(true);
      expect((await stat(destination)).mode & 0o7000).toBe(0);
    },
  );
  it("copies directories and dereferences safely when symlink creation is not permitted", async () => {
    const source = await mkdtemp(path.join(process.cwd(), ".portable-copy-fallback-"));
    temporaryRoots.push(source);
    await mkdir(path.join(source, "data"));
    await writeFile(path.join(source, "data", "file.txt"), "hello\n");

    const destinationParent = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-portable-copy-dest-"));
    temporaryRoots.push(destinationParent);
    const destination = path.join(destinationParent, "runtime");

    await copyDirectoryPortable(source, destination, { dereferenceSymlinks: true });
    await expect(readFile(path.join(destination, "data", "file.txt"), "utf8")).resolves.toBe("hello\n");
  });
});
