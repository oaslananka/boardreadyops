#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readlink, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { copyDirectoryPortable } from "./lib/portable-copy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(repositoryRoot, "apps", "web");
const standaloneSource = join(webRoot, ".next", "standalone");
const staticSource = join(webRoot, ".next", "static");
const publicSource = join(webRoot, "public");
const secret = randomBytes(32).toString("hex");
const payload = JSON.stringify({ zen: "standalone-runtime-ready" });

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureSymlinksContained(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(path);
      const resolvedTarget = resolve(dirname(path), target);
      const relativeTarget = relative(root, resolvedTarget);
      if (isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) {
        throw new Error(`Standalone output contains an escaping symlink: ${path} -> ${target}`);
      }
      continue;
    }
    if (metadata.isDirectory()) {
      await ensureSymlinksContained(root, path);
    }
  }
}

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a TCP port for the standalone smoke test"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function appendBounded(current, chunk, maximumBytes = 32_768) {
  const combined = `${current}${chunk.toString("utf8")}`;
  return combined.length <= maximumBytes ? combined : combined.slice(-maximumBytes);
}

async function waitForHealth(baseUrl, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Standalone server exited before becoming healthy.\n${output()}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      const body = await response.json();
      if (response.ok && body?.ok === true) {
        return;
      }
    } catch {
      // The server may still be binding its port.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(`Standalone server did not become healthy.\n${output()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

async function main() {
  const serverSource = join(standaloneSource, "apps", "web", "server.js");
  if (!(await pathExists(serverSource))) {
    throw new Error("Web standalone output is missing. Run `pnpm --filter @boardreadyops/web build` first.");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "boardreadyops-web-standalone-"));
  const isolatedRoot = join(temporaryRoot, "runtime");
  let child;
  let stdout = "";
  let stderr = "";

  try {
    await copyDirectoryPortable(standaloneSource, isolatedRoot);
    await ensureSymlinksContained(isolatedRoot);
    await mkdir(join(isolatedRoot, "apps", "web", ".next"), { recursive: true });
    await copyDirectoryPortable(staticSource, join(isolatedRoot, "apps", "web", ".next", "static"));
    if (await pathExists(publicSource)) {
      await copyDirectoryPortable(publicSource, join(isolatedRoot, "apps", "web", "public"), {
        dereferenceSymlinks: true,
      });
    }

    const port = await reservePort();
    const environment = { ...process.env };
    for (const name of [
      "NODE_PATH",
      "DATABASE_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_API_BASE_URL",
      "BOARDREADYOPS_DISPATCH_REPOSITORY",
      "BOARDREADYOPS_DISPATCH_WORKFLOW",
      "BOARDREADYOPS_DISPATCH_REF",
    ]) {
      delete environment[name];
    }
    Object.assign(environment, {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      GITHUB_WEBHOOK_SECRET: secret,
      BOARDREADYOPS_RUNNER_MODE: "disabled",
    });

    child = spawn(process.execPath, ["apps/web/server.js"], {
      cwd: isolatedRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });

    const output = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child, output);

    const signature = createHmac("sha256", secret).update(payload).digest("hex");
    const response = await fetch(`${baseUrl}/api/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "ping",
        "x-github-delivery": "standalone-smoke-delivery",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      body: payload,
    });
    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = undefined;
    }

    if (response.status !== 202 || responseBody?.ok !== true || responseBody?.event !== "ping") {
      throw new Error(
        `Standalone webhook smoke failed with status ${response.status}: ${responseText.slice(0, 1_024)}\n${output()}`,
      );
    }

    process.stdout.write("Web standalone runtime smoke passed.\n");
  } finally {
    if (child) {
      await stopChild(child);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
