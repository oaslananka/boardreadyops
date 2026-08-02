import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { authenticateRunnerRequest, runnerProtocolHeaderNames } from "../../apps/web/lib/runner-request-auth.js";
import { signRunnerRequest } from "../../packages/cloud-core/src/runner-request-signature.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlRunnerRegistrationEnrollmentStore } from "../../packages/db/src/runner-registration-enrollment-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 6 }) : undefined;
let githubInstallationId = 998_000_000;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(seed: string): string {
  return createHash("sha256").update(`revocation:${seed}`).digest("base64url");
}

function publicKey(seed: string): string {
  return `-----BEGIN PUBLIC KEY-----\n${createHash("sha256").update(seed).digest("base64")}\n-----END PUBLIC KEY-----`;
}

function signedClaim(input: {
  runnerId: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  now: Date;
  nonce: string;
}): { request: Request; body: string } {
  const path = "/api/v1/runner/jobs/claim";
  const body = JSON.stringify({
    protocolVersion: 1,
    workerClass: "self_hosted",
    capabilities: ["kicad:10"],
    labels: [],
  });
  const timestamp = Math.floor(input.now.valueOf() / 1000);
  const signature = signRunnerRequest({
    method: "POST",
    path,
    timestamp,
    nonce: input.nonce,
    workerClass: "self_hosted",
    runnerId: input.runnerId,
    body,
    privateKey: input.privateKey,
  });
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(runnerProtocolHeaderNames.protocolVersion, "1");
  headers.set(runnerProtocolHeaderNames.algorithm, "ed25519");
  headers.set(runnerProtocolHeaderNames.workerClass, "self_hosted");
  headers.set(runnerProtocolHeaderNames.runnerId, input.runnerId);
  headers.set(runnerProtocolHeaderNames.timestamp, String(timestamp));
  headers.set(runnerProtocolHeaderNames.nonce, input.nonce);
  headers.set(runnerProtocolHeaderNames.signature, signature);
  return {
    request: new Request(`https://boardreadyops.test${path}`, { method: "POST", headers, body }),
    body,
  };
}

async function createInstallation(label: string): Promise<string> {
  if (!executor) throw new Error("DATABASE_URL is required");
  const installationId = randomUUID();
  githubInstallationId += 1;
  await executor.query(
    `insert into installations (id, github_installation_id, account_login, account_type)
     values ($1, $2, $3, 'Organization')`,
    [installationId, githubInstallationId, `revocation-${label}-${installationId}`.slice(0, 100)],
  );
  return installationId;
}

async function cleanup(installationId: string): Promise<void> {
  if (!executor) return;
  await executor.query("delete from installations where id = $1", [installationId]);
}

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from installations where account_login like 'revocation-%'");
});

describeDatabase("runner registration revocation PostgreSQL lifecycle", () => {
  it("permanently disables old identities and requires a distinct replacement registration", async () => {
    if (!executor) throw new Error("DATABASE_URL is required");
    const installationId = await createInstallation("primary");
    const otherInstallationId = await createInstallation("other");
    let currentTime = new Date(Date.now() + 60_000);
    const enrollmentTokens = [token("active"), token("pending"), token("replacement")];
    const store = createSqlRunnerRegistrationEnrollmentStore(executor, {
      now: () => currentTime,
      enrollmentToken: () => enrollmentTokens.shift() ?? token(randomUUID()),
      enrollmentTtlSeconds: 300,
    });

    try {
      const oldIssued = await store.issueEnrollment({
        installationId,
        name: "factory-runner-old",
        scope: "repository",
        allowedRepositories: ["octo/private-board"],
      });
      expect(oldIssued.status).toBe("accepted");
      if (oldIssued.status !== "accepted") throw new Error("expected old enrollment issuance");
      const oldKeys = generateKeyPairSync("ed25519");
      const oldKey = oldKeys.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
      await expect(
        store.activateRegistration({
          enrollmentToken: oldIssued.enrollmentToken,
          publicKey: oldKey,
          capabilities: ["kicad:10"],
        }),
      ).resolves.toEqual({ status: "accepted", registrationId: oldIssued.registrationId, installationId });

      const authenticatedBefore = signedClaim({
        runnerId: oldIssued.registrationId,
        privateKey: oldKeys.privateKey,
        now: currentTime,
        nonce: token("auth-before-revocation"),
      });
      await expect(
        authenticateRunnerRequest({
          request: authenticatedBefore.request,
          body: authenticatedBefore.body,
          executor,
          now: currentTime,
        }),
      ).resolves.toMatchObject({
        identity: { workerClass: "self_hosted", runnerRegistrationId: oldIssued.registrationId },
      });

      await expect(
        store.revokeRegistration({
          installationId: otherInstallationId,
          registrationId: oldIssued.registrationId,
          actorId: "operator:release-engineering",
          reason: "suspected-compromise",
        }),
      ).resolves.toEqual({ status: "stale" });

      currentTime = new Date(currentTime.valueOf() + 30_000);
      const revoked = await store.revokeRegistration({
        installationId,
        registrationId: oldIssued.registrationId,
        actorId: "operator:release-engineering",
        reason: "suspected-compromise",
      });
      expect(revoked).toEqual({
        status: "accepted",
        registrationId: oldIssued.registrationId,
        revokedEnrollmentCount: 0,
        revokedAt: currentTime.toISOString(),
      });
      if (revoked.status !== "accepted") throw new Error("expected accepted revocation");

      const authenticatedAfter = signedClaim({
        runnerId: oldIssued.registrationId,
        privateKey: oldKeys.privateKey,
        now: currentTime,
        nonce: token("auth-after-revocation"),
      });
      await expect(
        authenticateRunnerRequest({
          request: authenticatedAfter.request,
          body: authenticatedAfter.body,
          executor,
          now: currentTime,
        }),
      ).resolves.toBeUndefined();

      currentTime = new Date(currentTime.valueOf() + 30_000);
      await expect(
        store.revokeRegistration({
          installationId,
          registrationId: oldIssued.registrationId,
          actorId: "operator:release-engineering",
          reason: "operator-request",
        }),
      ).resolves.toEqual({
        status: "replayed",
        registrationId: oldIssued.registrationId,
        revokedEnrollmentCount: 0,
        revokedAt: revoked.revokedAt,
      });

      await expect(
        store.activateRegistration({
          enrollmentToken: oldIssued.enrollmentToken,
          publicKey: oldKey,
          capabilities: ["kicad:10"],
        }),
      ).resolves.toEqual({ status: "conflict", registrationId: oldIssued.registrationId, installationId });
      await expect(
        store.issueEnrollment({
          installationId,
          name: "factory-runner-old",
          scope: "repository",
          allowedRepositories: ["octo/private-board"],
        }),
      ).resolves.toEqual({ status: "conflict", registrationId: oldIssued.registrationId });

      const pendingIssued = await store.issueEnrollment({
        installationId,
        name: "factory-runner-pending",
        scope: "installation",
        allowedRepositories: [],
      });
      expect(pendingIssued.status).toBe("accepted");
      if (pendingIssued.status !== "accepted") throw new Error("expected pending enrollment issuance");
      currentTime = new Date(currentTime.valueOf() + 30_000);
      await expect(
        store.revokeRegistration({
          installationId,
          registrationId: pendingIssued.registrationId,
          actorId: "operator:release-engineering",
          reason: "host-decommissioned",
        }),
      ).resolves.toEqual({
        status: "accepted",
        registrationId: pendingIssued.registrationId,
        revokedEnrollmentCount: 1,
        revokedAt: currentTime.toISOString(),
      });
      await expect(
        store.activateRegistration({
          enrollmentToken: pendingIssued.enrollmentToken,
          publicKey: publicKey("factory-runner-pending"),
          capabilities: ["kicad:10"],
        }),
      ).resolves.toEqual({ status: "stale", registrationId: pendingIssued.registrationId, installationId });

      const replacement = await store.issueEnrollment({
        installationId,
        name: "factory-runner-replacement",
        scope: "repository",
        allowedRepositories: ["octo/private-board"],
      });
      expect(replacement.status).toBe("accepted");
      if (replacement.status !== "accepted") throw new Error("expected replacement enrollment issuance");
      expect(replacement.registrationId).not.toBe(oldIssued.registrationId);
      await expect(
        store.activateRegistration({
          enrollmentToken: replacement.enrollmentToken,
          publicKey: publicKey("factory-runner-replacement"),
          capabilities: ["kicad:10"],
        }),
      ).resolves.toEqual({ status: "accepted", registrationId: replacement.registrationId, installationId });

      const oldRowResult = await executor.query(
        `select status, disabled_at, public_key, public_key_fingerprint, capabilities,
                scope, allowed_repositories, activated_at
         from runner_registrations where id = $1`,
        [oldIssued.registrationId],
      );
      expect((oldRowResult as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({
        status: "disabled",
        public_key: oldKey.trim(),
        public_key_fingerprint: digest(oldKey.trim()),
        capabilities: ["kicad:10"],
        scope: "repository",
        allowed_repositories: ["octo/private-board"],
      });
      expect((oldRowResult as { rows: Array<Record<string, unknown>> }).rows[0]?.disabled_at).not.toBeNull();
      expect((oldRowResult as { rows: Array<Record<string, unknown>> }).rows[0]?.activated_at).not.toBeNull();

      const auditResult = await executor.query(
        `select event_type, actor_type, actor_id, metadata
         from audit_events
         where runner_registration_id = $1
           and event_type = 'runner.registration.revoked'`,
        [oldIssued.registrationId],
      );
      const audits = (auditResult as { rows: Array<Record<string, unknown>> }).rows;
      expect(audits).toHaveLength(1);
      expect(audits[0]).toEqual({
        event_type: "runner.registration.revoked",
        actor_type: "operator",
        actor_id: "operator:release-engineering",
        metadata: {
          reason: "suspected-compromise",
          previousStatus: "active",
          revokedEnrollmentCount: 0,
        },
      });
      expect(JSON.stringify(audits)).not.toContain(oldIssued.enrollmentToken);
      expect(JSON.stringify(audits)).not.toContain(oldKey);
      expect(JSON.stringify(audits)).not.toContain("octo/private-board");
    } finally {
      await cleanup(otherInstallationId);
      await cleanup(installationId);
    }
  });
});
