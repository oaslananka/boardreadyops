import { afterEach, describe, expect, it } from "vitest";
import { getTenantDataRegion, InMemoryKmsAdapter } from "../../../packages/cloud-core/src/enterprise/kms-adapter.js";

describe("KmsAdapter", () => {
  it("round-trips ciphertext for the same tenant", async () => {
    const adapter = new InMemoryKmsAdapter();
    const { ciphertext, keyId } = await adapter.encrypt("tenant-a", "top secret credential");
    expect(keyId).toBe("alias/tenant-a-key");
    await expect(adapter.decrypt("tenant-a", ciphertext)).resolves.toBe("top secret credential");
  });

  it("scopes the key alias to the tenant so ciphertext is not portable across tenants", async () => {
    const adapter = new InMemoryKmsAdapter();
    const first = await adapter.encrypt("tenant-a", "value");
    const second = await adapter.encrypt("tenant-b", "value");
    expect(first.keyId).not.toBe(second.keyId);
  });
});

describe("getTenantDataRegion / KmsAdapter.getDataRegion", () => {
  const originalDefault = process.env.DEFAULT_DATA_REGION;
  const overrideKey = "KMS_REGION_ACME";
  const originalOverride = process.env[overrideKey];

  afterEach(() => {
    if (originalDefault === undefined) delete process.env.DEFAULT_DATA_REGION;
    else process.env.DEFAULT_DATA_REGION = originalDefault;
    if (originalOverride === undefined) delete process.env[overrideKey];
    else process.env[overrideKey] = originalOverride;
  });

  it("defaults to us-east-1 when nothing is configured", () => {
    delete process.env.DEFAULT_DATA_REGION;
    delete process.env[overrideKey];
    expect(getTenantDataRegion("acme")).toBe("us-east-1");
  });

  it("honors a tenant-specific region override", () => {
    process.env[overrideKey] = "eu-west-1";
    expect(getTenantDataRegion("acme")).toBe("eu-west-1");
  });

  it("ignores an invalid region override and falls back to the default", () => {
    process.env[overrideKey] = "mars-1";
    process.env.DEFAULT_DATA_REGION = "ap-northeast-1";
    expect(getTenantDataRegion("acme")).toBe("ap-northeast-1");
  });

  it("exposes the resolved region through the adapter interface", async () => {
    process.env.DEFAULT_DATA_REGION = "eu-west-1";
    delete process.env[overrideKey];
    const adapter = new InMemoryKmsAdapter();
    await expect(adapter.getDataRegion("acme")).resolves.toBe("eu-west-1");
  });
});
