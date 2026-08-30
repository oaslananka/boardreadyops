import { describe, expect, it, vi } from "vitest";
import { runRetentionMaintenanceCleanup } from "../../../apps/web/lib/retention-maintenance-worker.js";

function dependencies(overrides: Partial<Parameters<typeof runRetentionMaintenanceCleanup>[0]> = {}) {
  return {
    purgeWebhookInbox: vi.fn().mockResolvedValue(3),
    purgeRunnerRequestNonces: vi.fn().mockResolvedValue(7),
    expireArtifactUploadCapabilities: vi.fn().mockResolvedValue(5),
    revokeExpiredRunnerRegistrationEnrollments: vi.fn().mockResolvedValue(2),
    expireRepositorySetupProbes: vi.fn().mockResolvedValue(4),
    purgeTerminalArtifactUploadCapabilities: vi.fn().mockResolvedValue(6),
    purgeTerminalRunnerRegistrationEnrollments: vi.fn().mockResolvedValue(5),
    purgeTerminalRepositorySetupProbes: vi.fn().mockResolvedValue(3),
    purgeCompletedControlPlaneOutbox: vi.fn().mockResolvedValue(8),
    purgeCompletedControlPlaneReconciliationItems: vi.fn().mockResolvedValue(9),
    previewExpiredArtifactRetention: vi.fn().mockResolvedValue(11),
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
      terminalArtifactUploadCapabilitiesPurged: 6,
      terminalRunnerRegistrationEnrollmentsPurged: 5,
      terminalRepositorySetupProbesPurged: 3,
      completedControlPlaneOutboxPurged: 8,
      completedControlPlaneReconciliationItemsPurged: 9,
      artifactExpiryCandidatesPreviewed: 11,
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
      terminalArtifactUploadCapabilitiesPurged: 6,
      terminalRunnerRegistrationEnrollmentsPurged: 5,
      terminalRepositorySetupProbesPurged: 3,
      completedControlPlaneOutboxPurged: 8,
      completedControlPlaneReconciliationItemsPurged: 9,
      artifactExpiryCandidatesPreviewed: 11,
      failures: [{ scope: "webhook_inbox", errorClass: "TypeError" }],
      completed: false,
    });
    expect(input.purgeRunnerRequestNonces).toHaveBeenCalledOnce();
    expect(input.expireArtifactUploadCapabilities).toHaveBeenCalledOnce();
    expect(input.revokeExpiredRunnerRegistrationEnrollments).toHaveBeenCalledOnce();
    expect(input.expireRepositorySetupProbes).toHaveBeenCalledOnce();
    expect(input.purgeTerminalArtifactUploadCapabilities).toHaveBeenCalledOnce();
    expect(input.purgeTerminalRunnerRegistrationEnrollments).toHaveBeenCalledOnce();
    expect(input.purgeTerminalRepositorySetupProbes).toHaveBeenCalledOnce();
    expect(input.purgeCompletedControlPlaneOutbox).toHaveBeenCalledOnce();
    expect(input.purgeCompletedControlPlaneReconciliationItems).toHaveBeenCalledOnce();
    expect(input.previewExpiredArtifactRetention).toHaveBeenCalledOnce();
  });

  it("reports content-free error classes for multiple failures", async () => {
    const result = await runRetentionMaintenanceCleanup(
      dependencies({
        purgeRunnerRequestNonces: vi.fn().mockRejectedValue("token=private-value"),
        expireRepositorySetupProbes: vi.fn().mockRejectedValue(new RangeError("repository private-name")),
        purgeTerminalArtifactUploadCapabilities: vi.fn().mockRejectedValue(new Error("token=private-capability")),
        purgeCompletedControlPlaneOutbox: vi.fn().mockRejectedValue(new SyntaxError("private payload")),
        previewExpiredArtifactRetention: vi.fn().mockRejectedValue(new Error("private artifact locator")),
      }),
    );

    expect(result).toMatchObject({
      runnerRequestNoncesPurged: 0,
      repositorySetupProbesExpired: 0,
      terminalArtifactUploadCapabilitiesPurged: 0,
      completedControlPlaneOutboxPurged: 0,
      artifactExpiryCandidatesPreviewed: 0,
      failures: [
        { scope: "runner_request_nonces", errorClass: "UnknownError" },
        { scope: "repository_setup_probes", errorClass: "RangeError" },
        { scope: "terminal_artifact_upload_capabilities", errorClass: "Error" },
        { scope: "completed_control_plane_outbox", errorClass: "SyntaxError" },
        { scope: "artifact_retention_preview", errorClass: "Error" },
      ],
      completed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("private-name");
    expect(JSON.stringify(result)).not.toContain("private-capability");
    expect(JSON.stringify(result)).not.toContain("private payload");
    expect(JSON.stringify(result)).not.toContain("private artifact locator");
  });
});
