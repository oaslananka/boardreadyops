import { describe, expect, it } from "vitest";
import {
  runnerArtifactCapabilityRequestSchema,
  runnerClaimRequestSchema,
  runnerClaimResponseSchema,
  runnerLeaseHeartbeatRequestSchema,
  runnerTerminalResultRequestSchema,
} from "../../../packages/contracts/src/index.js";

const runId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const leaseId = "33333333-3333-4333-8333-333333333333";
const leaseToken = "a".repeat(43);

function leaseBinding() {
  return {
    runId,
    executionAttemptId: attemptId,
    leaseId,
    leaseToken,
  };
}

function leaseContext() {
  return {
    protocolVersion: 1 as const,
    ...leaseBinding(),
  };
}

describe("runner protocol contracts", () => {
  it("keeps claim requests capability-only and rejects caller-selected tenant work", () => {
    expect(
      runnerClaimRequestSchema.parse({
        protocolVersion: 1,
        workerClass: "managed",
        capabilities: ["kicad:10", "node:24"],
      }),
    ).toEqual({
      protocolVersion: 1,
      workerClass: "managed",
      capabilities: ["kicad:10", "node:24"],
      labels: [],
    });

    expect(
      runnerClaimRequestSchema.safeParse({
        protocolVersion: 1,
        workerClass: "managed",
        capabilities: [],
        installationId: "tenant-selected-by-caller",
        repository: "other-owner/private-board",
        runId,
      }).success,
    ).toBe(false);
  });

  it("validates server-assigned lease bounds and safe-mode source restrictions", () => {
    const valid = runnerClaimResponseSchema.safeParse({
      protocolVersion: 1,
      status: "claimed",
      job: {
        ...leaseBinding(),
        leaseExpiresAt: "2026-07-12T12:05:00.000Z",
        maximumLeaseExpiresAt: "2026-07-12T12:30:00.000Z",
        sourceMode: "broker",
        repository: {
          owner: "octo-org",
          name: "hardware-board",
          commitSha: "a".repeat(40),
          private: true,
        },
        safeMode: { enabled: true, reasons: ["private-repository"] },
      },
    });
    expect(valid.success).toBe(true);

    const forkBroker = runnerClaimResponseSchema.safeParse({
      protocolVersion: 1,
      status: "claimed",
      job: {
        ...leaseBinding(),
        leaseExpiresAt: "2026-07-12T12:05:00.000Z",
        maximumLeaseExpiresAt: "2026-07-12T12:30:00.000Z",
        sourceMode: "broker",
        repository: {
          owner: "octo-org",
          name: "hardware-board",
          commitSha: "a".repeat(40),
          private: false,
        },
        safeMode: { enabled: true, reasons: ["fork-pull-request"] },
      },
    });
    expect(forkBroker.success).toBe(false);
  });

  it("binds heartbeat, artifact, and terminal result messages to one lease attempt", () => {
    expect(
      runnerLeaseHeartbeatRequestSchema.safeParse({
        ...leaseContext(),
        stage: "running",
        progressPercent: 42,
      }).success,
    ).toBe(true);

    expect(
      runnerArtifactCapabilityRequestSchema.safeParse({
        ...leaseContext(),
        artifacts: [
          {
            kind: "html-report",
            name: "report.html",
            role: "primary",
            bytes: 4096,
            sha256: "b".repeat(64),
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      runnerTerminalResultRequestSchema.safeParse({
        ...leaseContext(),
        result: {
          version: 1,
          executionAttemptId: attemptId,
          status: "completed",
          decision: "pass",
          findings: [],
        },
      }).success,
    ).toBe(true);

    expect(
      runnerTerminalResultRequestSchema.safeParse({
        ...leaseContext(),
        result: {
          version: 1,
          executionAttemptId: "44444444-4444-4444-8444-444444444444",
          status: "completed",
          decision: "pass",
          findings: [],
        },
      }).success,
    ).toBe(false);
  });
});
