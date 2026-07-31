import { describe, expect, it, vi } from "vitest";
import { runRetentionMaintenanceCleanup } from "../../../apps/web/lib/retention-maintenance-worker.js";

describe("retention maintenance worker", () => {
  it("reports aggregate purge counts when both cleanup scopes succeed", async () => {
    const purgeWebhookInbox = vi.fn().mockResolvedValue(3);
    const purgeRunnerRequestNonces = vi.fn().mockResolvedValue(7);

    await expect(runRetentionMaintenanceCleanup({ purgeWebhookInbox, purgeRunnerRequestNonces })).resolves.toEqual({
      webhookInboxPurged: 3,
      runnerRequestNoncesPurged: 7,
      failures: [],
      completed: true,
    });
  });

  it("continues nonce cleanup when webhook inbox cleanup fails", async () => {
    const purgeWebhookInbox = vi.fn().mockRejectedValue(new TypeError("database timeout"));
    const purgeRunnerRequestNonces = vi.fn().mockResolvedValue(5);

    await expect(runRetentionMaintenanceCleanup({ purgeWebhookInbox, purgeRunnerRequestNonces })).resolves.toEqual({
      webhookInboxPurged: 0,
      runnerRequestNoncesPurged: 5,
      failures: [{ scope: "webhook_inbox", errorClass: "TypeError" }],
      completed: false,
    });
    expect(purgeRunnerRequestNonces).toHaveBeenCalledOnce();
  });

  it("continues webhook cleanup when nonce cleanup fails without exposing error text", async () => {
    const purgeWebhookInbox = vi.fn().mockResolvedValue(4);
    const purgeRunnerRequestNonces = vi.fn().mockRejectedValue("token=private-value");

    const result = await runRetentionMaintenanceCleanup({ purgeWebhookInbox, purgeRunnerRequestNonces });

    expect(result).toEqual({
      webhookInboxPurged: 4,
      runnerRequestNoncesPurged: 0,
      failures: [{ scope: "runner_request_nonces", errorClass: "UnknownError" }],
      completed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-value");
  });
});
