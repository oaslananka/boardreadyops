import { chmod, copyFile, lstat, mkdir, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function copyDirectoryPortable(source, destination, options = {}) {
  await copyEntry(source, destination, {
    dereferenceSymlinks: options.dereferenceSymlinks === true,
  });
}

async function copyEntry(source, destination, options) {
  const metadata = await lstat(source);

  if (metadata.isSymbolicLink()) {
    if (options.dereferenceSymlinks) {
      await copyEntry(await realpath(source), destination, options);
      return;
    }

    await mkdir(dirname(destination), { recursive: true });
    await symlink(await readlink(source), destination);
    return;
  }

  if (metadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyEntry(join(source, entry.name), join(destination, entry.name), options);
    }
    return;
  }

  if (metadata.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, metadata.mode & 0o777);
    return;
  }

  throw new Error(`Unsupported filesystem entry in portable copy: ${source}`);
}
