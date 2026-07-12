import { describe, expect, it, vi } from "vitest";
import { handleResultRequest, type ResultRouteDependencies } from "../../../apps/web/app/api/v1/runs/result/route.js";

const runId = "run-signed-terminal";
const executionAttemptId = "b31b614e-b656-491e-a6fa-59e13846bb0a";
const leaseId = "11e46ec0-2048-49c7-99e1-f77965218f0b";

describe("verified readiness result lease closure", () => {
  it("closes only the verified active lease in the atomic terminal-result statement", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: runId,
            github_check_run_id: null,
            pull_request_number: null,
            owner: "octo-org",
            name: "hardware-board",
            github_installation_id: 12345,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const dependencies: ResultRouteDependencies = {
      queryExecutor: () => ({ query }),
      checkRunClient: () => undefined,
      detailsUrl: () => undefined,
      now: () => new Date("2026-07-12T21:15:00.000Z"),
      verifyOidcToken: vi.fn(async () => false),
      authenticationVerified: true,
      verifiedLeaseId: leaseId,
    };
    const internalUrl = new URL("https://boardreadyops.internal/api/v1/runs/result");
    internalUrl.searchParams.set("run_id", runId);
    internalUrl.searchParams.set("attempt_id", executionAttemptId);
    const request = new Request(internalUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionAttemptId,
        version: 1,
        status: "completed",
        conclusion: "success",
        decision: "pass",
        findings: [],
        artifacts: [],
        metrics: {},
        reportLinks: [],
      }),
    });

    const response = await handleResultRequest(request, dependencies);

    expect(response.status).toBe(202);
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("completed_lease as");
    expect(sql).toContain("update runner_job_leases");
    expect(sql).toContain("runner_job_leases.id = $15");
    expect(sql).toContain("runner_job_leases.execution_attempt_id = $2");
    expect(sql).toContain("runner_job_leases.status = 'active'");
    expect(sql).toContain("'leaseCompleted', exists(select 1 from completed_lease)");
    expect(params[14]).toBe(leaseId);
  });
});
