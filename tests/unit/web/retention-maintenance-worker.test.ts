import { describe, expect, it, vi } from "vitest";
import { runRetentionMaintenanceCleanup } from "../../../apps/web/lib/retention-maintenance-worker.js";

function dependencies(overrides: Partial<Parameters<typeof runRetentionMaintenanceCleanup>[0]> = {}) {
  return {
    purgeWebhookInbox: vi.fn().mockResolvedValue(3),
    purgeRunnerRequestNonces: vi.fn().mockResolvedValue(7),
    expireArtifactUploadCapabilities: vi.fn().mockResolvedValue(5),
    revokeExpiredRunnerRegistrationEnrollments: vi.fn().mockResolvedValue(2),
    expireRepositorySetupProbes: vi.fn().mockResolvedValue(4),
    ...overrides,
  };
}

describe("retention maintenance worker", () => {
  it("reports aggregate cleanup counts when every scope succeeds", async () => {
    await expect(runRetentionMaintenanceCleanup(dependencies())).resolves.toEqual({
      webhookInboxPurged: 3,
      runnerRequestNoncesPurged: 7,
      artifactUploadCapabilitiesExpired: 5,
      runnerRegistrationEnrollmentsRevoked: 2,
      repositorySetupProbesExpired: 4,
      failures: [],
      completed: true,
    });
  });

  it("continues every independent cleanup scope when one scope fails", async () => {
    const input = dependencies({ purgeWebhookInbox: vi.fn().mockRejectedValue(new TypeError("database timeout")) });

    await expect(runRetentionMaintenanceCleanup(input)).resolves.toEqual({
      webhookInboxPurged: 0,
      runnerRequestNoncesPurged: 7,
      artifactUploadCapabilitiesExpired: 5,
      runnerRegistrationEnrollmentsRevoked: 2,
      repositorySetupProbesExpired: 4,
      failures: [{ scope: "webhook_inbox", errorClass: "TypeError" }],
      completed: false,
    });
    expect(input.purgeRunnerRequestNonces).toHaveBeenCalledOnce();
    expect(input.expireArtifactUploadCapabilities).toHaveBeenCalledOnce();
    expect(input.revokeExpiredRunnerRegistrationEnrollments).toHaveBeenCalledOnce();
    expect(input.expireRepositorySetupProbes).toHaveBeenCalledOnce();
  });

  it("reports content-free error classes for multiple failures", async () => {
    const result = await runRetentionMaintenanceCleanup(
      dependencies({
        purgeRunnerRequestNonces: vi.fn().mockRejectedValue("token=private-value"),
        expireRepositorySetupProbes: vi.fn().mockRejectedValue(new RangeError("repository private-name")),
      }),
    );

    expect(result).toMatchObject({
      runnerRequestNoncesPurged: 0,
      repositorySetupProbesExpired: 0,
      failures: [
        { scope: "runner_request_nonces", errorClass: "UnknownError" },
        { scope: "repository_setup_probes", errorClass: "RangeError" },
      ],
      completed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("private-name");
  });
});
