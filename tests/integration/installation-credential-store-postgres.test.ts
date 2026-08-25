import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCredentialCipher } from "../../packages/cloud-core/src/credential-encryption.js";
import { createSqlInstallationCredentialStore } from "../../packages/db/src/installation-credential-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "8d000000-0000-4000-8000-000000000001";
const otherInstallationId = "8d000000-0000-4000-8000-000000000002";
const key = Buffer.alloc(32, 7).toString("base64");

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

beforeAll(async () => {
  if (!executor) return;
  for (const [index, id] of [installationId, otherInstallationId].entries()) {
    await database().query("delete from installations where id = $1", [id]);
    await database().query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, $2, 'credential-store', 'Organization')`,
      [id, 48_100 + index],
    );
  }
});

afterAll(async () => {
  if (!executor) return;
  for (const id of [installationId, otherInstallationId]) {
    await database().query("delete from installations where id = $1", [id]);
  }
  await executor.close();
});

describeDatabase("installation credential store", () => {
  it("stores only ciphertext, never the credential itself", async () => {
    const store = createSqlInstallationCredentialStore(database());
    const cipher = createCredentialCipher(key);
    const secret = "nexar-client-secret-abc123";

    await store.put(installationId, "nexar", cipher.encrypt(secret));

    const raw = rows(
      await database().query(
        "select credential_envelope from installation_component_credentials where installation_id = $1",
        [installationId],
      ),
    );
    const envelope = String(raw[0]?.credential_envelope);
    // The point of the table: a dump is not a credential leak.
    expect(envelope).not.toContain(secret);
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(cipher.decrypt(envelope)).toBe(secret);
  });

  it("replaces a credential in place rather than accumulating rows", async () => {
    const store = createSqlInstallationCredentialStore(database());
    const cipher = createCredentialCipher(key);

    await store.put(installationId, "nexar", cipher.encrypt("first"));
    await store.put(installationId, "nexar", cipher.encrypt("second"));

    const count = rows(
      await database().query(
        "select count(*)::int as total from installation_component_credentials where installation_id = $1",
        [installationId],
      ),
    );
    expect(count[0]?.total).toBe(1);
    const found = await store.find(installationId, "nexar");
    expect(cipher.decrypt(found?.envelope ?? "")).toBe("second");
  });

  it("keeps one installation's credential invisible to another", async () => {
    const store = createSqlInstallationCredentialStore(database());
    const cipher = createCredentialCipher(key);
    await store.put(installationId, "nexar", cipher.encrypt("mine"));

    expect(await store.find(otherInstallationId, "nexar")).toBeUndefined();
  });

  it("records a rejection without discarding the credential", async () => {
    const store = createSqlInstallationCredentialStore(database());
    const cipher = createCredentialCipher(key);
    await store.put(installationId, "nexar", cipher.encrypt("secret"));

    await store.markRejected(installationId, "nexar", "provider returned 401", new Date("2026-08-25T09:00:00.000Z"));

    const found = await store.find(installationId, "nexar");
    // A revoked key and a provider outage look identical from here, so the secret is kept and
    // the customer is not made to re-enter it for what may be transient.
    expect(cipher.decrypt(found?.envelope ?? "")).toBe("secret");
    expect(found?.rejectedReason).toBe("provider returned 401");
    expect(found?.rejectedAt).toBeTruthy();
  });

  it("clears the rejection when a new credential is stored", async () => {
    const store = createSqlInstallationCredentialStore(database());
    const cipher = createCredentialCipher(key);
    await store.put(installationId, "nexar", cipher.encrypt("old"));
    await store.markRejected(installationId, "nexar", "revoked", new Date());

    await store.put(installationId, "nexar", cipher.encrypt("new"));

    const found = await store.find(installationId, "nexar");
    // Keeping the rejection would report a problem the customer has just fixed.
    expect(found?.rejectedAt).toBeUndefined();
    expect(found?.rejectedReason).toBeUndefined();
  });

  it("clears the rejection when a lookup succeeds again", async () => {
    const store = createSqlInstallationCredentialStore(database());
    await store.put(installationId, "nexar", createCredentialCipher(key).encrypt("secret"));
    await store.markRejected(installationId, "nexar", "rate limited", new Date());

    await store.clearRejection(installationId, "nexar");

    expect((await store.find(installationId, "nexar"))?.rejectedAt).toBeUndefined();
  });

  it("removes a credential and reports whether anything was removed", async () => {
    const store = createSqlInstallationCredentialStore(database());
    await store.put(installationId, "nexar", createCredentialCipher(key).encrypt("secret"));

    expect(await store.remove(installationId, "nexar")).toBe(true);
    expect(await store.remove(installationId, "nexar")).toBe(false);
    expect(await store.find(installationId, "nexar")).toBeUndefined();
  });

  it("refuses a provider name that is not an identifier", async () => {
    const store = createSqlInstallationCredentialStore(database());

    // Free text would let a typo create a second row that no lookup ever matches.
    await expect(store.put(installationId, "Nexar Inc", "v1.a.b.c")).rejects.toThrow();
  });

  it("removes credentials with the installation they belong to", async () => {
    const store = createSqlInstallationCredentialStore(database());
    await database().query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, 48199, 'credential-cascade', 'Organization')
       on conflict (id) do nothing`,
      ["8d000000-0000-4000-8000-0000000000ff"],
    );
    await store.put("8d000000-0000-4000-8000-0000000000ff", "nexar", "v1.a.b.c");

    await database().query("delete from installations where id = $1", ["8d000000-0000-4000-8000-0000000000ff"]);

    expect(await store.find("8d000000-0000-4000-8000-0000000000ff", "nexar")).toBeUndefined();
  });
});
