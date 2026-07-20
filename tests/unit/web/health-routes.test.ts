import { afterEach, describe, expect, it } from "vitest";
import { GET as getLive } from "../../../apps/web/app/api/health/live/route.js";
import { GET as getReady } from "../../../apps/web/app/api/health/ready/route.js";
import { GET as getHealth } from "../../../apps/web/app/api/health/route.js";

const trackedEnvironmentNames = ["DATABASE_URL", "GITHUB_WEBHOOK_SECRET", "BOARDREADYOPS_PERSISTENCE_MODE"] as const;
const originalEnvironment = new Map(trackedEnvironmentNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("cloud health routes", () => {
  it("serves dependency-free liveness", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_WEBHOOK_SECRET;

    const response = getLive();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "boardreadyops-cloud",
      check: "liveness",
    });
  });

  it("keeps /api/health as a liveness alias", async () => {
    const response = getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "boardreadyops-cloud",
      check: "liveness",
    });
  });

  it("returns 503 readiness when required configuration is missing", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_WEBHOOK_SECRET;

    const response = await getReady();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: "boardreadyops-cloud",
      check: "readiness",
      reason: "missing-configuration",
      missing: ["DATABASE_URL", "GITHUB_WEBHOOK_SECRET"],
    });
  });
});
