import { describe, expect, it } from "vitest";
import {
  runnerLeaseHeartbeatResponseSchema,
  runnerLeaseRelinquishRequestSchema,
  runnerMutationResponseSchema,
  runnerRegistrationActivationResponseSchema,
  runnerSafeModeSchema,
} from "../../../packages/contracts/src/runner-protocol.js";

const leaseContext = {
  protocolVersion: 1 as const,
  runId: "11111111-1111-4111-8111-111111111111",
  executionAttemptId: "22222222-2222-4222-8222-222222222222",
  leaseId: "33333333-3333-4333-8333-333333333333",
  leaseToken: "a".repeat(43),
};

describe("runner protocol forward compatibility", () => {
  describe("unknown enum values from a newer Control Plane are rejected, not silently accepted", () => {
    it("rejects an unrecognized lease heartbeat status", () => {
      const result = runnerLeaseHeartbeatResponseSchema.safeParse({
        protocolVersion: 1,
        status: "paused", // not in ["active", "expired", "revoked", "completed", "stale"]
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unrecognized mutation response status", () => {
      const result = runnerMutationResponseSchema.safeParse({
        protocolVersion: 1,
        status: "queued", // not in ["accepted", "replayed"]
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unrecognized registration activation status", () => {
      const result = runnerRegistrationActivationResponseSchema.safeParse({
        protocolVersion: 1,
        status: "pending", // not in ["activated", "replayed"]
        registrationId: "44444444-4444-4444-8444-444444444444",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unrecognized lease relinquish reason", () => {
      const result = runnerLeaseRelinquishRequestSchema.safeParse({
        ...leaseContext,
        reason: "network_partition", // not in ["shutdown", "capacity", "operator", "job_error"]
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unrecognized safe-mode reason", () => {
      const result = runnerSafeModeSchema.safeParse({
        enabled: true,
        reasons: ["organization-policy"], // not in the three known reasons
      });
      expect(result.success).toBe(false);
    });
  });

  describe("unknown/additional fields from a newer Control Plane are rejected (.strict()), not ignored", () => {
    it("rejects an extra field on a lease heartbeat response", () => {
      const result = runnerLeaseHeartbeatResponseSchema.safeParse({
        protocolVersion: 1,
        status: "active",
        leaseExpiresAt: "2026-01-01T00:00:00.000Z",
        maximumLeaseExpiresAt: "2026-01-01T00:10:00.000Z",
        estimatedCostCents: 42, // hypothetical future field
      });
      expect(result.success).toBe(false);
    });

    it("rejects an extra field on a mutation response", () => {
      const result = runnerMutationResponseSchema.safeParse({
        protocolVersion: 1,
        status: "accepted",
        auditId: "55555555-5555-4555-8555-555555555555", // hypothetical future field
      });
      expect(result.success).toBe(false);
    });
  });
});
