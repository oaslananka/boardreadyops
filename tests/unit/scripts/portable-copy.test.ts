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
  it.skipIf(process.platform === "win32")(
    "copies setgid source trees without applying special permission bits",
    async () => {
      const source = await mkdtemp(path.join(process.cwd(), ".portable-copy-source-"));
      temporaryRoots.push(source);
      await chmod(source, 0o2700).catch(() => undefined);
      await mkdir(path.join(source, "nested"));
      await writeFile(path.join(source, "nested", "evidence.txt"), "verified\n");
      await symlink(path.join("nested", "evidence.txt"), path.join(source, "evidence-link"));

      const destinationParent = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-portable-copy-"));
      temporaryRoots.push(destinationParent);
      const destination = path.join(destinationParent, "runtime");

      expect((await stat(source)).mode & 0o2000).toBe(0o2000);

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
