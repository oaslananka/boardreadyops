import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scriptPath = fileURLToPath(new URL("../../../scripts/unlighthouse-authenticated.mjs", import.meta.url));
const legacyConfigPath = fileURLToPath(new URL("../../../unlighthouse.auth.config.ts", import.meta.url));

describe("authenticated Lighthouse runner", () => {
  it("ships the authenticated orchestrator without the legacy Unlighthouse config", () => {
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(legacyConfigPath)).toBe(false);
  });

  it("keeps generated authenticated audit state out of git", () => {
    const gitignore = readFileSync(`${root}/.gitignore`, "utf8");
    expect(gitignore).toContain("/.unlighthouse/");
  });
});

it("pins direct Lighthouse tooling and keeps credential-free audit scripts", () => {
  const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  expect(packageJson.devDependencies["@unlighthouse/core"]).toBeUndefined();
  expect(packageJson.devDependencies.lighthouse).toBe("13.5.0");
  expect(packageJson.devDependencies["chrome-launcher"]).toBe("1.2.1");
  expect(packageJson.scripts["qa:unlighthouse:auth"]).toBe("node scripts/unlighthouse-authenticated.mjs");
  expect(packageJson.scripts["qa:unlighthouse:auth:debug"]).toBe("node scripts/unlighthouse-authenticated.mjs --debug");
  expect(packageJson.scripts["qa:unlighthouse:auth:routes"]).toBe(
    "node scripts/unlighthouse-authenticated.mjs --routes-only",
  );
  expect(JSON.stringify(packageJson.scripts)).not.toContain("BROPS_SESSION=");
});

it("parses a short-lived session and refuses insecure or untrusted targets", async () => {
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
    parseAuthenticatedAuditOptions({
      BROPS_SESSION: "valid.session",
      BROPS_UNLIGHTHOUSE_SITE: "https://example.com",
    }),
  ).toThrow("BROPS_UNLIGHTHOUSE_SITE must target boardreadyops.com or loopback");
  expect(() =>
    parseAuthenticatedAuditOptions({
      BROPS_SESSION: "valid.session",
      BROPS_UNLIGHTHOUSE_SITE: "http://boardreadyops.com",
    }),
  ).toThrow("BROPS_UNLIGHTHOUSE_SITE must use HTTPS unless it targets loopback");
});

it("builds bounded Lighthouse flags with the session only in the in-memory request header", async () => {
  const { buildAuthenticatedLighthouseFlags } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const flags = buildAuthenticatedLighthouseFlags({
    session: "ephemeral.session",
    port: 9222,
    headful: false,
  });

  expect(flags).toMatchObject({
    port: 9222,
    logLevel: "error",
    output: "json",
    onlyCategories: ["performance", "accessibility", "best-practices"],
    disableStorageReset: true,
    formFactor: "desktop",
    extraHeaders: { Cookie: "brops_session=ephemeral.session" },
  });
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

  expect(result).toMatchObject({ exitCode: 0, manifest, budgetFailures: [], scanFailures: [] });
  expect(written).toHaveLength(1);
  expect(written[0]).toContain('"/dashboard"');
  expect(written[0]).not.toContain(session);
});

it("audits discovered routes, enforces budgets, writes a secret-free summary, and closes Chrome", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const session = "never-persist-this";
  const lighthouseImpl = vi.fn(async () => ({
    lhr: {
      categories: {
        performance: { score: 0.69 },
        accessibility: { score: 0.95 },
        "best-practices": { score: 0.9 },
      },
    },
  }));
  const kill = vi.fn(async () => undefined);
  const summaries: unknown[] = [];

  const result = await runAuthenticatedAudit({
    environment: { BROPS_SESSION: session },
    discoverImpl: async () => ({
      site: "https://boardreadyops.com",
      generatedAt: "now",
      routes: ["/dashboard"],
    }),
    writeManifestImpl: async () => undefined,
    writeAuditSummaryImpl: async (summary: unknown) => summaries.push(summary),
    detectChromeImpl: async () => "/usr/bin/google-chrome",
    launchChromeImpl: async () => ({ port: 9222, kill }),
    lighthouseImpl,
  });

  expect(result.exitCode).toBe(1);
  expect(result.budgetFailures).toEqual([{ path: "/dashboard", category: "performance", score: 69, minimum: 70 }]);
  expect(kill).toHaveBeenCalledOnce();
  expect(lighthouseImpl).toHaveBeenCalledWith(
    "https://boardreadyops.com/dashboard",
    expect.objectContaining({
      port: 9222,
      extraHeaders: { Cookie: `brops_session=${session}` },
    }),
  );
  expect(JSON.stringify(summaries)).not.toContain(session);
  expect(summaries).toEqual([
    {
      site: "https://boardreadyops.com",
      generatedAt: "now",
      routes: [
        {
          path: "/dashboard",
          scores: { performance: 69, accessibility: 95, "best-practices": 90 },
        },
      ],
      scanFailures: [],
      budgetFailures: [{ path: "/dashboard", category: "performance", score: 69, minimum: 70 }],
    },
  ]);
});

it("fails closed on a Lighthouse route error but still closes Chrome", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");
  const kill = vi.fn(async () => undefined);

  const result = await runAuthenticatedAudit({
    environment: { BROPS_SESSION: "ephemeral" },
    discoverImpl: async () => ({
      site: "https://boardreadyops.com",
      generatedAt: "now",
      routes: ["/dashboard"],
    }),
    writeManifestImpl: async () => undefined,
    writeAuditSummaryImpl: async () => undefined,
    detectChromeImpl: async () => "/usr/bin/google-chrome",
    launchChromeImpl: async () => ({ port: 9222, kill }),
    lighthouseImpl: async () => {
      throw new Error("audit failed");
    },
  });

  expect(result.exitCode).toBe(1);
  expect(result.scanFailures).toEqual([{ path: "/dashboard", status: "audit failed" }]);
  expect(kill).toHaveBeenCalledOnce();
});

it("fails before launching when no installed Chrome is available", async () => {
  const { runAuthenticatedAudit } = await import("../../../scripts/unlighthouse-authenticated.mjs");

  await expect(
    runAuthenticatedAudit({
      environment: { BROPS_SESSION: "ephemeral" },
      discoverImpl: async () => ({
        site: "https://boardreadyops.com",
        generatedAt: "now",
        routes: ["/dashboard"],
      }),
      writeManifestImpl: async () => undefined,
      detectChromeImpl: async () => undefined,
    }),
  ).rejects.toThrow("Installed Chrome is required");
});
