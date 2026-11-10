import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDrainMarkerPath = "/run/boardreadyops/draining";
const defaultServerFile = fileURLToPath(new URL("./server.js", import.meta.url));

/**
 * Keep the existing Next.js server reachable until Docker healthcheck and
 * the reverse proxy have removed this container from the serving pool.
 * Next.js retains control of its own graceful shutdown after the delay.
 */
export function startWebSupervisor({
  parent = process,
  spawnServer = () => spawn(process.execPath, [defaultServerFile], { stdio: "inherit", env: process.env }),
  markerPath = defaultDrainMarkerPath,
  drainMs = 12_000,
  onExit = (code) => {
    process.exitCode = code;
  },
} = {}) {
  // A process restart within an existing container must never inherit a
  // previous drain marker and become permanently unavailable.
  rmSync(markerPath, { force: true });
  const child = spawnServer();
  let draining = false;
  let markerFailed = false;
  let timer;

  const startDrain = (signal) => {
    if (draining) return;
    draining = true;
    try {
      writeFileSync(markerPath, "1", { flag: "wx", mode: 0o600 });
    } catch {
      markerFailed = true;
      process.stderr.write("boardreadyops_drain_marker_failed\n");
    }
    timer = setTimeout(() => child.kill(signal), drainMs);
  };
  const onSigterm = () => startDrain("SIGTERM");
  const onSigint = () => startDrain("SIGINT");
  parent.on("SIGTERM", onSigterm);
  parent.on("SIGINT", onSigint);

  child.once("close", (code, signal) => {
    if (timer !== undefined) clearTimeout(timer);
    parent.off("SIGTERM", onSigterm);
    parent.off("SIGINT", onSigint);
    let exitStatus = 1;
    if (!markerFailed) {
      if (typeof code === "number") {
        exitStatus = code;
      } else if (draining && (signal === "SIGTERM" || signal === "SIGINT")) {
        exitStatus = 0;
      }
    }
    onExit(exitStatus);
  });
  child.once("error", () => {
    markerFailed = true;
    process.stderr.write("boardreadyops_web_spawn_failed\n");
  });
  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startWebSupervisor();
}
