import { describe, expect, it } from "vitest";
import { summarizeIntegrationHealth } from "../../../apps/web/lib/integration-health.js";

const installation = {
  id: "installation-a",
  githubInstallationId: 101,
  accountLogin: "acme-hardware",
  planTier: "business",
  hasComponentCredential: true,
  componentCredentialRejectedAt: undefined,
  componentCredentialRejectedReason: undefined,
};

describe("summarizeIntegrationHealth", () => {
  it("combines real setup, component and runner signals for one installation", () => {
    const result = summarizeIntegrationHealth({
      cloud: { ok: true },
      installations: [installation],
      repositories: [{ accountLogin: "acme-hardware", repositories: [{ id: "repo-1" }, { id: "repo-2" }] }],
      setup: new Map([["installation-a", { ready: 1, attention: 1, unconfigured: 0 }]]),
      runnerFleet: new Map([
        [
          "installation-a",
          {
            status: "healthy",
            registrations: { active: 2, online: 2, stale: 0, versionUnreported: 0 },
            queue: { pendingJobs: 0 },
            leases: { active: 0 },
            versions: [],
            observedAt: "2026-09-10T18:00:00.000Z",
            observationWindowSeconds: 300,
          },
        ],
      ]),
    });

    expect(result.deployment).toEqual({ status: "healthy" });
    expect(result.installations[0]).toMatchObject({
      accountLogin: "acme-hardware",
      githubApp: "connected",
      repositories: { total: 2, ready: 1, attention: 1, unconfigured: 0 },
      componentIntelligence: "configured",
      runner: { status: "healthy", active: 2, online: 2, pendingJobs: 0 },
    });
  });

  it("marks rejected credentials and missing runner/setup state as attention without inventing data", () => {
    const result = summarizeIntegrationHealth({
      cloud: { ok: false, reason: "database-timeout" },
      installations: [
        { ...installation, hasComponentCredential: true, componentCredentialRejectedAt: "2026-09-10T17:00:00.000Z" },
      ],
      repositories: [{ accountLogin: "acme-hardware", repositories: [{ id: "repo-1" }] }],
      setup: new Map(),
      runnerFleet: new Map(),
    });

    expect(result.deployment).toEqual({ status: "degraded", reason: "database-timeout" });
    expect(result.installations[0]?.componentIntelligence).toBe("rejected");
    expect(result.installations[0]?.repositories).toEqual({ total: 1, ready: 0, attention: 0, unconfigured: 1 });
    expect(result.installations[0]?.runner).toEqual({ status: "not_configured", active: 0, online: 0, pendingJobs: 0 });
  });
});
