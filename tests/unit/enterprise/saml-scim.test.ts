import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSamlEnvConfig, InMemorySamlAdapter } from "../../../packages/cloud-core/src/enterprise/saml-adapter.js";
import { InMemoryScimAdapter } from "../../../packages/cloud-core/src/enterprise/scim-adapter.js";

describe("SamlAdapter", () => {
  const envKeys = ["SAML_ENTITY_ID", "SAML_ACS_URL", "SAML_IDP_METADATA_URL", "SAML_CERTIFICATE"] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("returns null configuration when no tenant override or environment is set", async () => {
    for (const key of envKeys) delete process.env[key];
    const adapter = new InMemorySamlAdapter();
    await expect(adapter.getConfig("tenant-a")).resolves.toBeNull();
    expect(getSamlEnvConfig()).toBeNull();
  });

  it("falls back to environment configuration when no tenant override exists", async () => {
    process.env.SAML_ENTITY_ID = "urn:boardreadyops:sp";
    process.env.SAML_ACS_URL = "https://app.example.test/sso/acs";
    process.env.SAML_IDP_METADATA_URL = "https://idp.example.test/metadata";
    process.env.SAML_CERTIFICATE = "-----BEGIN CERTIFICATE-----abc-----END CERTIFICATE-----";

    const adapter = new InMemorySamlAdapter();
    await expect(adapter.getConfig("tenant-a")).resolves.toMatchObject({ entityId: "urn:boardreadyops:sp" });
  });

  it("rejects an assertion that is too short to be real", async () => {
    const adapter = new InMemorySamlAdapter();
    await expect(adapter.validateAssertion("short")).rejects.toThrow("Invalid SAML response");
  });

  it("decodes a base64-encoded JSON assertion for contract testing", async () => {
    const adapter = new InMemorySamlAdapter();
    const payload = Buffer.from(
      JSON.stringify({
        userId: "user-1",
        email: "engineer@example.test",
        nameId: "nameId-1",
        sessionIndex: "sess-1",
        expiresAt: new Date().toISOString(),
      }),
    ).toString("base64");

    await expect(adapter.validateAssertion(payload)).resolves.toMatchObject({
      userId: "user-1",
      email: "engineer@example.test",
    });
  });

  it("produces a logout URL bound to the session index", async () => {
    const adapter = new InMemorySamlAdapter();
    const url = await adapter.initiateLogout({
      userId: "user-1",
      email: "engineer@example.test",
      nameId: "nameId-1",
      sessionIndex: "sess-42",
      expiresAt: new Date().toISOString(),
    });
    expect(url).toContain("sess-42");
  });
});

describe("ScimAdapter", () => {
  it("provisions a user scoped to a tenant and assigns a generated id", async () => {
    const adapter = new InMemoryScimAdapter();
    const user = await adapter.provisionUser("tenant-a", {
      externalId: "ext-1",
      userName: "jane",
      email: "jane@example.test",
      active: true,
    });
    expect(user.id).toBeTruthy();
    await expect(adapter.getUser("tenant-a", user.id)).resolves.toMatchObject({ userName: "jane" });
  });

  it("keeps tenants isolated from each other", async () => {
    const adapter = new InMemoryScimAdapter();
    const user = await adapter.provisionUser("tenant-a", {
      externalId: "ext-1",
      userName: "jane",
      email: "jane@example.test",
      active: true,
    });
    await expect(adapter.getUser("tenant-b", user.id)).resolves.toBeNull();
    await expect(adapter.listUsers("tenant-b")).resolves.toEqual([]);
  });

  it("disables a user without deleting their record", async () => {
    const adapter = new InMemoryScimAdapter();
    const user = await adapter.provisionUser("tenant-a", {
      externalId: null,
      userName: "jane",
      email: "jane@example.test",
      active: true,
    });
    await adapter.disableUser("tenant-a", user.id);
    await expect(adapter.getUser("tenant-a", user.id)).resolves.toMatchObject({ active: false });
  });

  it("deprovisions a user so their record is fully removed", async () => {
    const adapter = new InMemoryScimAdapter();
    const user = await adapter.provisionUser("tenant-a", {
      externalId: null,
      userName: "jane",
      email: "jane@example.test",
      active: true,
    });
    await adapter.deprovisionUser("tenant-a", user.id);
    await expect(adapter.getUser("tenant-a", user.id)).resolves.toBeNull();
  });

  it("rejects deprovisioning or disabling a user that does not exist", async () => {
    const adapter = new InMemoryScimAdapter();
    await expect(adapter.deprovisionUser("tenant-a", "missing")).rejects.toThrow("User not found");
    await expect(adapter.disableUser("tenant-a", "missing")).rejects.toThrow("User not found");
  });
});
