import { describe, expect, it } from "vitest";
import neonLifecycle from "../../../functions/boardreadyops-lifecycle.js";

describe("Neon production lifecycle entrypoint", () => {
  it("does not start workers or open any database until explicitly enabled", async () => {
    const enabled = process.env.BOARDREADYOPS_NEON_LIFECYCLE_ENABLED;
    delete process.env.BOARDREADYOPS_NEON_LIFECYCLE_ENABLED;
    try {
      const response = await neonLifecycle.fetch(new Request("https://example.neon.tech/", { method: "POST" }));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("DATABASE_URL");
    } finally {
      if (enabled === undefined) delete process.env.BOARDREADYOPS_NEON_LIFECYCLE_ENABLED;
      else process.env.BOARDREADYOPS_NEON_LIFECYCLE_ENABLED = enabled;
    }
  });
});
