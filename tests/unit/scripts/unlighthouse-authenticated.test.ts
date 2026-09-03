import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scriptPath = fileURLToPath(new URL("../../../scripts/unlighthouse-authenticated.mjs", import.meta.url));
const configPath = fileURLToPath(new URL("../../../unlighthouse.auth.config.ts", import.meta.url));

describe("authenticated Unlighthouse runner", () => {
  it("ships an authenticated orchestrator and config", () => {
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  it("keeps generated Unlighthouse state out of git", () => {
    const gitignore = readFileSync(`${root}/.gitignore`, "utf8");
    expect(gitignore).toContain("/.unlighthouse/");
  });
});

it("pins Unlighthouse and exposes credential-free audit scripts", () => {
  const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  expect(packageJson.devDependencies["@unlighthouse/core"]).toBe("0.18.0");
  expect(packageJson.scripts["qa:unlighthouse:auth"]).toBe("node scripts/unlighthouse-authenticated.mjs");
  expect(packageJson.scripts["qa:unlighthouse:auth:debug"]).toBe("node scripts/unlighthouse-authenticated.mjs --debug");
  expect(packageJson.scripts["qa:unlighthouse:auth:routes"]).toBe(
    "node scripts/unlighthouse-authenticated.mjs --routes-only",
  );
  expect(JSON.stringify(packageJson.scripts)).not.toContain("BROPS_SESSION=");
});

it("exports testable audit option, config, and runner functions", async () => {
  const module = await import("../../../scripts/unlighthouse-authenticated.mjs");

  expect(typeof module.parseAuthenticatedAuditOptions).toBe("function");
  expect(typeof module.buildAuthenticatedUnlighthouseConfig).toBe("function");
  expect(typeof module.runAuthenticatedAudit).toBe("function");
});

it("parses a short-lived session and refuses insecure non-loopback targets", async () => {
  const { parseAuthenticatedAuditOptions } = await import("../../../scripts/unlighthouse-authenticated.mjs");

  expect(
    parseAuthenticatedAuditOptions(
      { BROPS_SESSION: "valid.session", BROPS_UNLIGHTHOUSE_SITE: "https://boardreadyops.com" },
      [],
    ),
  ).toEqual({
    site: "https://boardreadyops.com",
    session: "valid.session",
    routesOnly: false,
    headful: false,
  });
  expect(() => parseAuthenticatedAuditOptions({ BROPS_SESSION: "" }, [])).toThrow("BROPS_SESSION is required");
  expect(() =>
    parseAuthenticatedAuditOptions(
      { BROPS_SESSION: "valid.session", BROPS_UNLIGHTHOUSE_SITE: "http://boardreadyops.com" },
      [],
    ),
  ).toThrow("BROPS_UNLIGHTHOUSE_SITE must use HTTPS unless it targets loopback");
  expect(
    parseAuthenticatedAuditOptions(
      { BROPS_SESSION: "valid.session", BROPS_UNLIGHTHOUSE_SITE: "http://127.0.0.1:4123" },
      ["--routes-only", "--debug"],
    ),
  ).toMatchObject({ routesOnly: true, headful: true });
});

it("builds a bounded desktop Unlighthouse config with the session cookie", async () => {
  const { buildAuthenticatedUnlighthouseConfig } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const config = buildAuthenticatedUnlighthouseConfig({
    site: "https://boardreadyops.com",
    session: "valid.session",
    routes: ["/dashboard", "/runs/run-1"],
    headful: false,
  });

  expect(config).toMatchObject({
    site: "https://boardreadyops.com",
    urls: ["/dashboard", "/runs/run-1"],
    outputPath: ".unlighthouse/authenticated",
    cache: false,
    cookies: [{ name: "brops_session", value: "valid.session", domain: "boardreadyops.com", path: "/" }],
    scanner: {
      device: "desktop",
      samples: 1,
      crawler: false,
      robotsTxt: false,
      sitemap: false,
      dynamicSampling: false,
    },
    puppeteerClusterOptions: { maxConcurrency: 1 },
    puppeteerOptions: { headless: true },
    lighthouseOptions: {
      disableStorageReset: true,
      onlyCategories: ["performance", "accessibility", "best-practices"],
    },
    ci: { budget: { performance: 70, accessibility: 90, "best-practices": 85 }, buildStatic: true },
  });
  expect(JSON.stringify({ ...config, cookies: undefined })).not.toContain("valid.session");
});

it("writes only the secret-free manifest in routes-only mode", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const written: string[] = [];
  const session = "never-write-this-session";
  const manifest = {
    site: "https://boardreadyops.com",
    generatedAt: "2026-09-03T04:00:00.000Z",
    routes: ["/dashboard"],
  };

  const result = await runAuthenticatedAudit({
    environment: { BROPS_SESSION: session },
    argv: ["--routes-only"],
    discoverImpl: async () => manifest,
    writeManifestImpl: async (payload: string) => written.push(payload),
  });

  expect(result).toMatchObject({ exitCode: 0, manifest });
  expect(written).toHaveLength(1);
  expect(written[0]).toContain('"/dashboard"');
  expect(written[0]).not.toContain(session);
});

it("runs Unlighthouse core, generates a static client, and enforces category budgets", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  let finished: (() => void | Promise<void>) | undefined;
  let generatedStatic = false;
  const reports = () => [
    {
      route: { path: "/dashboard" },
      tasks: { runLighthouseTask: "completed" },
      report: {
        categories: { performance: { score: 0.69 }, accessibility: { score: 0.95 }, "best-practices": { score: 0.9 } },
      },
    },
  ];

  const context = {
    hooks: {
      hook: (name: string, callback: () => void | Promise<void>) => {
        if (name === "worker-finished") finished = callback;
      },
    },
    setCiContext: async () => context,
    start: async () => {
      queueMicrotask(() => void finished?.());
      return { routes: [{ path: "/dashboard" }] };
    },
    worker: { reports, cluster: { close: async () => {} } },
  };
  const coreImpl = {
    createUnlighthouse: async () => context,
    generateClient: async ({ static: isStatic }: { static: boolean }) => {
      generatedStatic = isStatic;
    },
  };

  const result = await runAuthenticatedAudit({
    environment: { BROPS_SESSION: "valid.session" },
    argv: [],
    discoverImpl: async () => ({ site: "https://boardreadyops.com", generatedAt: "now", routes: ["/dashboard"] }),
    writeManifestImpl: async () => {},
    coreImpl,
  });

  expect(generatedStatic).toBe(true);
  expect(result.exitCode).toBe(1);
  expect(result.budgetFailures).toEqual([{ path: "/dashboard", category: "performance", score: 69, minimum: 70 }]);
});

it("loads the generated manifest and ephemeral session through the shared config builder", () => {
  const source = readFileSync(configPath, "utf8");

  expect(source).toContain("buildAuthenticatedUnlighthouseConfig");
  expect(source).toContain("BROPS_SESSION");
  expect(source).toContain("authenticated-routes.json");
  expect(source).not.toContain("valid.session");
});

it("uses an installed browser and refuses runtime browser downloads", async () => {
  const { buildAuthenticatedUnlighthouseConfig } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const config = buildAuthenticatedUnlighthouseConfig({
    site: "https://boardreadyops.com",
    session: "ephemeral",
    routes: ["/dashboard"],
  });

  expect(config.chrome).toEqual({ useSystem: true, useDownloadFallback: false });
});

it("never sends the authenticated session to an untrusted host", async () => {
  const { parseAuthenticatedAuditOptions } = await import("../../../scripts/unlighthouse-authenticated.mjs");

  expect(() =>
    parseAuthenticatedAuditOptions({
      BROPS_SESSION: "ephemeral",
      BROPS_UNLIGHTHOUSE_SITE: "https://example.com",
    }),
  ).toThrow("BROPS_UNLIGHTHOUSE_SITE must target boardreadyops.com or loopback");
});

it("closes the browser cluster after a completed audit", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  let finished: (() => void | Promise<void>) | undefined;
  let closed = false;
  const context = {
    hooks: { hook: (_name: string, callback: () => void | Promise<void>) => (finished = callback) },
    setCiContext: async () => context,
    start: async () => {
      queueMicrotask(() => void finished?.());
      return { routes: [{ path: "/dashboard" }] };
    },
    worker: {
      reports: () => [
        {
          route: { path: "/dashboard" },
          tasks: { runLighthouseTask: "completed" },
          report: {
            categories: { performance: { score: 1 }, accessibility: { score: 1 }, "best-practices": { score: 1 } },
          },
        },
      ],
      cluster: {
        close: async () => {
          closed = true;
        },
      },
    },
  };
  const coreImpl = { createUnlighthouse: async () => context, generateClient: async () => {} };
  const result = await runAuthenticatedAudit({
    environment: { BROPS_SESSION: "valid.session" },
    discoverImpl: async () => ({ site: "https://boardreadyops.com", generatedAt: "now", routes: ["/dashboard"] }),
    writeManifestImpl: async () => {},
    coreImpl,
  });

  expect(result.exitCode).toBe(0);
  expect(closed).toBe(true);
});

it("closes the browser cluster when report generation throws", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  let finished: (() => void | Promise<void>) | undefined;
  let closed = false;
  const context = {
    hooks: { hook: (_name: string, callback: () => void | Promise<void>) => (finished = callback) },
    setCiContext: async () => context,
    start: async () => {
      queueMicrotask(() => void finished?.());
      return { routes: [{ path: "/dashboard" }] };
    },
    worker: {
      reports: () => [
        {
          route: { path: "/dashboard" },
          tasks: { runLighthouseTask: "completed" },
          report: {
            categories: { performance: { score: 1 }, accessibility: { score: 1 }, "best-practices": { score: 1 } },
          },
        },
      ],
      cluster: {
        close: async () => {
          closed = true;
        },
      },
    },
  };
  const coreImpl = {
    createUnlighthouse: async () => context,
    generateClient: async () => {
      throw new Error("static generation failed");
    },
  };

  await expect(
    runAuthenticatedAudit({
      environment: { BROPS_SESSION: "valid.session" },
      discoverImpl: async () => ({ site: "https://boardreadyops.com", generatedAt: "now", routes: ["/dashboard"] }),
      writeManifestImpl: async () => {},
      coreImpl,
    }),
  ).rejects.toThrow("static generation failed");
  expect(closed).toBe(true);
});

it("fails closed when a queued Lighthouse route never completes", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  let finished: (() => void | Promise<void>) | undefined;
  const context = {
    hooks: { hook: (_name: string, callback: () => void | Promise<void>) => (finished = callback) },
    setCiContext: async () => context,
    start: async () => {
      queueMicrotask(() => void finished?.());
      return { routes: [{ path: "/dashboard" }] };
    },
    worker: {
      reports: () => [{ route: { path: "/dashboard" }, tasks: { runLighthouseTask: "failed" } }],
      cluster: { close: async () => {} },
    },
  };
  const result = await runAuthenticatedAudit({
    environment: { BROPS_SESSION: "valid.session" },
    discoverImpl: async () => ({ site: "https://boardreadyops.com", generatedAt: "now", routes: ["/dashboard"] }),
    writeManifestImpl: async () => {},
    coreImpl: { createUnlighthouse: async () => context, generateClient: async () => {} },
  });

  expect(result.exitCode).toBe(1);
  expect(result.scanFailures).toEqual([{ path: "/dashboard", status: "failed" }]);
});

it("waits for the browser cluster to become idle before finalizing reports", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  let finished: (() => void | Promise<void>) | undefined;
  const calls: string[] = [];
  const context = {
    hooks: { hook: (_name: string, callback: () => void | Promise<void>) => (finished = callback) },
    setCiContext: async () => context,
    start: async () => {
      queueMicrotask(() => void finished?.());
      return { routes: [{ path: "/dashboard" }] };
    },
    worker: {
      reports: () => [
        { route: { path: "/dashboard" }, tasks: { runLighthouseTask: "completed" }, report: { categories: {} } },
      ],
      cluster: {
        idle: async () => calls.push("idle"),
        close: async () => calls.push("close"),
      },
    },
  };
  await runAuthenticatedAudit({
    environment: { BROPS_SESSION: "valid.session" },
    discoverImpl: async () => ({ site: "https://boardreadyops.com", generatedAt: "now", routes: ["/dashboard"] }),
    writeManifestImpl: async () => {},
    coreImpl: { createUnlighthouse: async () => context, generateClient: async () => calls.push("generate") },
  });

  expect(calls).toEqual(["idle", "generate", "close"]);
});

it("waits for terminal route reports even if worker-finished is missed", async () => {
  const module = await import("../../../scripts/unlighthouse-authenticated.mjs");
  expect(typeof module.waitForWorkerCompletion).toBe("function");

  let poll = 0;
  const worker = {
    reports: () => {
      poll += 1;
      if (poll === 1) return [];
      return [{ route: { path: "/dashboard" }, tasks: { runLighthouseTask: "completed" } }];
    },
    monitor: () => ({ status: poll >= 2 ? "completed" : "working" }),
  };
  const sleeps: number[] = [];
  await module.waitForWorkerCompletion(worker, ["/dashboard"], {
    timeoutMs: 1000,
    pollMs: 25,
    sleep: async (ms: number) => sleeps.push(ms),
  });

  expect(sleeps).toEqual([25]);
});

it("works around the Unlighthouse display shim when closing the cluster", async () => {
  const { closeWorkerCluster } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const cluster = {
    display: { log() {}, resetCursor() {} },
    close: async function () {
      if (this.display && typeof this.display.close !== "function")
        throw new TypeError("display.close is not a function");
    },
  };

  await expect(closeWorkerCluster(cluster)).resolves.toBeUndefined();
  expect(cluster.display).toBeNull();
});
