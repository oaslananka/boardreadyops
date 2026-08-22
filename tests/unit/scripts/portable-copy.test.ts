import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyDirectoryPortable } from "../../../scripts/lib/portable-copy.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable directory copy", () => {
  it("preserves directory symlink type for pnpm-style relative targets", async ({ skip }) => {
    const source = await mkdtemp(path.join(process.cwd(), ".portable-copy-directory-source-"));
    temporaryRoots.push(source);
    const packageDirectory = "next@16.2.11_@babel+core@7._be10f97c94e825087e2e0e278d75b52b";
    const target = path.join("..", "..", "..", "node_modules", ".pnpm", packageDirectory, "node_modules", "next");
    const sourceLink = path.join(source, "apps", "web", "node_modules", "next");
    await mkdir(path.dirname(sourceLink), { recursive: true });
    await mkdir(path.resolve(path.dirname(sourceLink), target), { recursive: true });
    try {
      await symlink(target, sourceLink, "dir");
    } catch (error: unknown) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException)?.code === "EPERM") {
        skip("creating symlinks on Windows requires developer mode or elevated privilege");
        return;
      }
      throw error;
    }

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
});
