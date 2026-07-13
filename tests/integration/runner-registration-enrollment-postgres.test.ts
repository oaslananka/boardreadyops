import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerRegistrationEnrollmentStore } from "../../packages/db/src/runner-registration-enrollment-store.js";

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 6 }) : undefined;
let githubInstallationId = 997_000_000;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(seed: string): string {
  return createHash("sha256").update(`enrollment:${seed}`).digest("base64url");
}

function publicKey(seed: string): string {
  return `-----BEGIN PUBLIC KEY-----\n${createHash("sha256").update(seed).digest("base64")}\n-----END PUBLIC KEY-----`;
}

async function createInstallation(label: string): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const installationId = randomUUID();
  githubInstallationId += 1;
  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubInstallationId, `enrollment-${label}-${installationId}`.slice(0, 100)],
  );
  return installationId;
}

async function cleanup(installationId: string): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [installationId]);
}

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where account_login like 'enrollment-enrollment-test-%'");
});

describeDatabase("self-hosted runner enrollment PostgreSQL lifecycle", () => {
  it("rotates pending tokens, stores only digests, activates once, and permits exact replay", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const installationId = await createInstallation("enrollment-test-rotation");
    let currentTime = new Date(Date.now() + 60_000);
    const enrollmentTokens = [token("first"), token("second")];
    const store = createSqlRunnerRegistrationEnrollmentStore(executor, {
      now: () => currentTime,
      enrollmentToken: () => enrollmentTokens.shift() ?? token(randomUUID()),
      enrollmentTtlSeconds: 300,
    });

    try {
      const first = await store.issueEnrollment({
        installationId,
        name: "factory-runner-01",
        scope: "repository",
        allowedRepositories: ["octo/board-b", "octo/board-a", "octo/board-a"],
      });
      expect(first.status).toBe("accepted");
      if (first.status !== "accepted") throw new Error("expected first enrollment issuance");

      currentTime = new Date(currentTime.valueOf() + 30_000);
      const second = await store.issueEnrollment({
        installationId,
        name: "factory-runner-01",
        scope: "repository",
        allowedRepositories: ["octo/board-a", "octo/board-b"],
      });
      expect(second.status).toBe("accepted");
      if (second.status !== "accepted") throw new Error("expected rotated enrollment issuance");
      expect(second.registrationId).toBe(first.registrationId);
      expect(second.enrollmentToken).not.toBe(first.enrollmentToken);

      const enrollmentRows = await executor.query(
        `select token_digest, consumed_at, revoked_at
         from runner_registration_enrollments
         where runner_registration_id = $1
         order by created_at asc`,
        [first.registrationId],
      );
      const enrollments = (enrollmentRows as { rows: Array<Record<string, unknown>> }).rows;
      expect(enrollments).toHaveLength(2);
      expect(enrollments[0]).toMatchObject({ token_digest: digest(first.enrollmentToken), consumed_at: null });
      expect(enrollments[0]?.revoked_at).not.toBeNull();
      expect(enrollments[1]).toMatchObject({
        token_digest: digest(second.enrollmentToken),
        consumed_at: null,
        revoked_at: null,
      });
      expect(JSON.stringify(enrollments)).not.toContain(first.enrollmentToken);
      expect(JSON.stringify(enrollments)).not.toContain(second.enrollmentToken);

      const key = publicKey("factory-runner-01");
      await expect(
        store.activateRegistration({
          enrollmentToken: first.enrollmentToken,
          publicKey: key,
          capabilities: ["kicad:10", "docker", "kicad:10"],
        }),
      ).resolves.toMatchObject({ status: "stale", registrationId: first.registrationId, installationId });

      const activated = await store.activateRegistration({
        enrollmentToken: second.enrollmentToken,
        publicKey: key,
        capabilities: ["kicad:10", "docker", "kicad:10"],
      });
      expect(activated).toEqual({ status: "accepted", registrationId: first.registrationId, installationId });

      await expect(
        store.activateRegistration({
          enrollmentToken: second.enrollmentToken,
          publicKey: key,
          capabilities: ["docker", "kicad:10"],
        }),
      ).resolves.toEqual({ status: "replayed", registrationId: first.registrationId, installationId });

      await expect(
        store.activateRegistration({
          enrollmentToken: second.enrollmentToken,
          publicKey: publicKey("altered-key"),
          capabilities: ["docker", "kicad:10"],
        }),
      ).resolves.toEqual({ status: "conflict", registrationId: first.registrationId, installationId });

      const registrationResult = await executor.query(
        `select status, public_key, public_key_fingerprint, capabilities, allowed_repositories,
                activated_at, last_heartbeat_at, disabled_at
         from runner_registrations
         where id = $1`,
        [first.registrationId],
      );
      const registration = (registrationResult as { rows: Array<Record<string, unknown>> }).rows[0];
      expect(registration).toMatchObject({
        status: "active",
        public_key: key,
        public_key_fingerprint: digest(key),
        capabilities: ["docker", "kicad:10"],
        allowed_repositories: ["octo/board-a", "octo/board-b"],
        disabled_at: null,
      });
      expect(registration?.activated_at).not.toBeNull();
      expect(registration?.last_heartbeat_at).not.toBeNull();

      const auditResult = await executor.query(
        `select event_type, actor_type, metadata
         from audit_events
         where runner_registration_id = $1
         order by created_at asc, id asc`,
        [first.registrationId],
      );
      const audits = (auditResult as { rows: Array<Record<string, unknown>> }).rows;
      const eventTypes = audits.map((row) => row.event_type);
      expect(eventTypes).toHaveLength(3);
      expect(eventTypes.filter((eventType) => eventType === "runner.registration.enrollment_issued")).toHaveLength(2);
      expect(eventTypes.filter((eventType) => eventType === "runner.registration.activated")).toHaveLength(1);
      const activationAudit = audits.find((row) => row.event_type === "runner.registration.activated");
      expect(activationAudit).toMatchObject({
        actor_type: "registered_actor",
        metadata: {
          publicKeyFingerprint: digest(key),
          capabilityCount: 2,
        },
      });
      expect(JSON.stringify(audits)).not.toContain(second.enrollmentToken);
    } finally {
      await cleanup(installationId);
    }
  });

  it("rejects an expired enrollment without activating the registration", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const installationId = await createInstallation("enrollment-test-expiry");
    let currentTime = new Date(Date.now() + 60_000);
    const store = createSqlRunnerRegistrationEnrollmentStore(executor, {
      now: () => currentTime,
      enrollmentToken: () => token("expired"),
      enrollmentTtlSeconds: 60,
    });

    try {
      const issued = await store.issueEnrollment({
        installationId,
        name: "expired-runner",
        scope: "installation",
        allowedRepositories: [],
      });
      expect(issued.status).toBe("accepted");
      if (issued.status !== "accepted") throw new Error("expected enrollment issuance");

      currentTime = new Date(currentTime.valueOf() + 61_000);
      await expect(
        store.activateRegistration({
          enrollmentToken: issued.enrollmentToken,
          publicKey: publicKey("expired-runner"),
          capabilities: ["kicad:10"],
        }),
      ).resolves.toMatchObject({ status: "stale", registrationId: issued.registrationId, installationId });

      const registrationResult = await executor.query(
        "select status, public_key from runner_registrations where id = $1",
        [issued.registrationId],
      );
      expect((registrationResult as { rows: Array<Record<string, unknown>> }).rows[0]).toEqual({
        status: "pending",
        public_key: null,
      });
    } finally {
      await cleanup(installationId);
    }
  });
});
