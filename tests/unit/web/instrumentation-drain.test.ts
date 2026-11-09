import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "../../../apps/web/instrumentation.js";

const originalDsn = process.env.SENTRY_DSN;
const originalRuntime = process.env.NEXT_RUNTIME;
const originalDrain = process.env.BOARDREADYOPS_SHUTTING_DOWN;

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, original] of [
    ["SENTRY_DSN", originalDsn],
    ["NEXT_RUNTIME", originalRuntime],
    ["BOARDREADYOPS_SHUTTING_DOWN", originalDrain],
  ] as const) {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe("rolling-web termination readiness", () => {
  it("marks the process unready on SIGTERM without disabling Next.js shutdown or requiring Sentry", async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.BOARDREADYOPS_SHUTTING_DOWN;
    process.env.NEXT_RUNTIME = "nodejs";
    const originalManualSignalHandling = process.env.NEXT_MANUAL_SIG_HANDLE;

    const handlers = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (event === "SIGTERM" || event === "SIGINT") handlers.set(event, listener as () => void);
      return process;
    });

    await register();

    expect(handlers.has("SIGTERM")).toBe(true);
    expect(handlers.has("SIGINT")).toBe(true);
    handlers.get("SIGTERM")?.();
    expect(process.env.BOARDREADYOPS_SHUTTING_DOWN).toBe("1");
    expect(process.env.NEXT_MANUAL_SIG_HANDLE).toBe(originalManualSignalHandling);
  });

  it("does not attach Node.js process signal handlers in the Edge runtime", async () => {
    delete process.env.SENTRY_DSN;
    process.env.NEXT_RUNTIME = "edge";
    const once = vi.spyOn(process, "once").mockImplementation(() => process);

    await register();

    expect(once).not.toHaveBeenCalled();
  });

  it("makes container readiness depend on the actual readiness endpoint", () => {
    const dockerfile = readFileSync(new URL("../../../apps/web/Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("/api/health/ready");
  });
});
