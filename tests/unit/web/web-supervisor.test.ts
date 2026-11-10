import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWebSupervisor } from "../../../apps/web/web-supervisor.mjs";

const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "boardreadyops-supervisor-"));
  directories.push(directory);
  const markerPath = join(directory, "draining");
  const parent = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn(() => true);
  const onExit = vi.fn();
  const spawnServer = vi.fn(() => child);
  return { markerPath, parent, child, onExit, spawnServer };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("web server connection draining", () => {
  it("clears stale draining state before starting the child", () => {
    const f = fixture();
    writeFileSync(f.markerPath, "stale", { mode: 0o600 });
    f.spawnServer.mockImplementationOnce(() => {
      expect(existsSync(f.markerPath)).toBe(false);
      return f.child;
    });

    startWebSupervisor({ ...f, drainMs: 12_000 });

    expect(f.spawnServer).toHaveBeenCalledOnce();
    expect(existsSync(f.markerPath)).toBe(false);
    f.child.emit("close", 0, null);
    expect(f.onExit).toHaveBeenCalledWith(0);
  });

  it("marks readiness unavailable immediately on SIGTERM and keeps the old server alive for drain", () => {
    vi.useFakeTimers();
    const f = fixture();
    startWebSupervisor({ ...f, drainMs: 12_000 });

    f.parent.emit("SIGTERM");

    expect(readFileSync(f.markerPath, "utf8")).toBe("1");
    if (process.platform !== "win32") {
      expect(statSync(f.markerPath).mode & 0o777).toBe(0o600);
    }
    expect(f.child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11_999);
    expect(f.child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");

    f.child.emit("close", null, "SIGTERM");
    expect(f.onExit).toHaveBeenCalledWith(0);
  });

  it("does not restart draining or send repeated kill signals for multiple stop signals", () => {
    vi.useFakeTimers();
    const f = fixture();
    startWebSupervisor({ ...f, drainMs: 12_000 });

    f.parent.emit("SIGINT");
    vi.advanceTimersByTime(3_000);
    f.parent.emit("SIGTERM");
    vi.advanceTimersByTime(9_000);

    expect(f.child.kill).toHaveBeenCalledExactlyOnceWith("SIGINT");
    f.child.emit("close", 0, null);
    expect(f.parent.listenerCount("SIGTERM")).toBe(0);
    expect(f.parent.listenerCount("SIGINT")).toBe(0);
  });

  it.skipIf(process.platform === "win32")(
    "forwards an actual OS SIGTERM to a real child only after draining",
    async () => {
      const f = fixture();
      const directory = join(f.markerPath, "..");
      const readyFile = join(directory, "child-started");
      const moduleUrl = pathToFileURL(resolve("apps/web/web-supervisor.mjs")).href;
      const childSource =
        "const fs=require('node:fs');fs.writeFileSync(process.env.CHILD_READY,'running');setInterval(()=>{},100)";
      const program = [
        "import { spawn } from 'node:child_process';",
        `import { startWebSupervisor } from ${JSON.stringify(moduleUrl)};`,
        "startWebSupervisor({markerPath:process.env.DRAIN_MARKER,drainMs:1200,spawnServer:()=>spawn(process.execPath,['-e'," +
          JSON.stringify(childSource) +
          "],{env:process.env,stdio:'ignore'})});",
      ].join("\n");

      const supervisor = spawn(process.execPath, ["--input-type=module", "-e", program], {
        env: { ...process.env, DRAIN_MARKER: f.markerPath, CHILD_READY: readyFile },
        stdio: "ignore",
      });
      try {
        for (let i = 0; i < 100 && !existsSync(readyFile); i++) {
          await new Promise((r) => setTimeout(r, 30));
        }
        expect(existsSync(readyFile)).toBe(true);
        expect(supervisor.exitCode).toBeNull();

        supervisor.kill("SIGTERM");
        for (let i = 0; i < 100 && !existsSync(f.markerPath); i++) {
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(existsSync(f.markerPath)).toBe(true);
        expect(supervisor.exitCode).toBeNull();

        const [code, signal] = await Promise.race([
          once(supervisor, "exit"),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("supervisor did not exit")), 5_000)),
        ]);
        expect(signal).toBeNull();
        expect(code).toBe(0);
      } finally {
        if (supervisor.exitCode === null) supervisor.kill("SIGKILL");
      }
    },
  );

  it("propagates unexpected child failure rather than reporting a healthy process", () => {
    const f = fixture();
    startWebSupervisor({ ...f, drainMs: 12_000 });

    f.child.emit("close", 17, null);

    expect(f.onExit).toHaveBeenCalledWith(17);
    f.parent.emit("SIGTERM");
    expect(existsSync(f.markerPath)).toBe(false);
    expect(f.child.kill).not.toHaveBeenCalled();
  });
});
