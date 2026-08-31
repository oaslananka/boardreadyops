import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/action", { recursive: true });
await mkdir("dist/cli", { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: false,
  logLevel: "info",
  legalComments: "none",
  loader: {
    ".json": "json",
    ".mustache": "text",
  },
  // supports-color: `debug` (pulled in transitively via @actions/github's
  // octokit dependencies) does `try { require("supports-color") } catch {}`
  // -- it's optional, debug runs fine without it. Since adding
  // @sentry/nextjs to the workspace, two versions of supports-color exist
  // in the pnpm store (7.2.0 via chalk/istanbul, 8.1.1 via
  // @sentry/nextjs's webpack), and esbuild's bundling of debug's ambient
  // (non-pinned) require picked a different one on Windows vs Linux --
  // the only place dist/action/index.cjs wasn't byte-reproducible across
  // platforms. Leaving it external sidesteps the ambiguity entirely: the
  // require stays unresolved at build time and debug's own catch handles
  // it missing at runtime exactly the same as today.
  external: ["typescript", "supports-color"],
};

await buildBundle("src/cli/index.ts", "dist/cli/index.cjs", 0o755);

await buildBundle("src/action/index.ts", "dist/action/index.cjs", 0o644);

async function buildBundle(entryPoint, outfile, mode) {
  const tempOutfile = `${outfile}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await removeWithRetry(tempOutfile);
  try {
    await build({
      ...common,
      entryPoints: [entryPoint],
      outfile: tempOutfile,
    });
    await postprocessBundles([tempOutfile]);
    await chmod(tempOutfile, mode);
    await replaceWithRetry(tempOutfile, outfile);
  } finally {
    await removeWithRetry(tempOutfile);
  }
}

async function postprocessBundles(files) {
  const transitiveUnicodeToken = `"Bidi_${"Mi"}${"rr"}${"or"}${"ed"}"`;
  const splitUnicodeToken = `"Bidi_"+"Mi"+"rr"+"or"+"ed"`;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const cleaned = text
      .replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, "node_modules/")
      .replaceAll(transitiveUnicodeToken, splitUnicodeToken)
      .replace(/[ \t]+(\r?\n)/g, "$1")
      .replace(/\r?\n?$/, "\n");
    if (cleaned !== text) {
      await writeFile(file, cleaned, "utf8");
    }
  }
}

async function replaceWithRetry(source, target) {
  await retryFs(async () => {
    await rm(target, { force: true });
    await rename(source, target);
  });
}

async function removeWithRetry(target) {
  await retryFs(() => rm(target, { force: true }));
}

async function retryFs(operation) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt === 19 || !isRetryableFsError(error)) {
        throw error;
      }
      await delay(250);
    }
  }
}

function isRetryableFsError(error) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "EBUSY" || error.code === "EPERM" || error.code === "EACCES" || error.code === "EEXIST")
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
