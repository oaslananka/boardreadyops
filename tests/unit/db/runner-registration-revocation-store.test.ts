import { describe, expect, it, vi } from "vitest";
import { createSqlRunnerRegistrationEnrollmentStore } from "../../../packages/db/src/runner-registration-enrollment-store.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const registrationId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-02T12:10:00.000Z");

describe("runner registration revocation store", () => {
  it("revokes one tenant-scoped registration with minimal result metadata", async () => {
    const query = vi.fn(async (_sql: string, _params: readonly unknown[] = []) => ({
      rows: [
        {
          outcome: "accepted",
          registration_id: registrationId,
          revoked_enrollment_count: 2,
          revoked_at: now,
        },
      ],
    }));
    const store = createSqlRunnerRegistrationEnrollmentStore({ query }, { now: () => now });

    await expect(
      store.revokeRegistration({
        installationId,
        registrationId,
        actorId: "operator:release-engineering",
        reason: "suspected-compromise",
      }),
    ).resolves.toEqual({
      status: "accepted",
      registrationId,
      revokedEnrollmentCount: 2,
      revokedAt: now.toISOString(),
    });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("boardreadyops_revoke_runner_registration");
    expect(query.mock.calls[0]?.[1]).toEqual([
      now.toISOString(),
      installationId,
      registrationId,
      "operator:release-engineering",
      "suspected-compromise",
    ]);
  });

  it("preserves the original revocation timestamp on idempotent replay", async () => {
    const revokedAt = "2026-08-02T12:05:00.000Z";
    const query = vi.fn(async () => ({
      rows: [
        {
          outcome: "replayed",
          registration_id: registrationId,
          revoked_enrollment_count: 0,
          revoked_at: revokedAt,
        },
      ],
    }));
    const store = createSqlRunnerRegistrationEnrollmentStore({ query }, { now: () => now });

    await expect(
      store.revokeRegistration({
        installationId,
        registrationId,
        actorId: "operator:release-engineering",
        reason: "operator-request",
      }),
    ).resolves.toEqual({
      status: "replayed",
      registrationId,
      revokedEnrollmentCount: 0,
      revokedAt,
    });
  });

  it("rejects malformed actor identities and non-allowlisted reasons before database access", async () => {
    const query = vi.fn();
    const store = createSqlRunnerRegistrationEnrollmentStore({ query }, { now: () => now });

    await expect(
      store.revokeRegistration({
        installationId,
        registrationId,
        actorId: "operator with spaces",
        reason: "free-form-incident-detail" as never,
      }),
    ).resolves.toEqual({ status: "stale" });
    expect(query).not.toHaveBeenCalled();
  });
});
