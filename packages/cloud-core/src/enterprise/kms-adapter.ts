export type DataRegion = "us-east-1" | "eu-west-1" | "ap-northeast-1";

interface KmsAdapter {
  encrypt(tenantId: string, plaintext: string): Promise<{ ciphertext: string; keyId: string }>;
  decrypt(tenantId: string, ciphertext: string): Promise<string>;
  getDataRegion(tenantId: string): Promise<DataRegion>;
}

export function getTenantDataRegion(tenantId: string): DataRegion {
  const override = process.env[`KMS_REGION_${tenantId.toUpperCase()}`] as DataRegion | undefined;
  if (override && ["us-east-1", "eu-west-1", "ap-northeast-1"].includes(override)) return override;
  return (process.env.DEFAULT_DATA_REGION as DataRegion) ?? "us-east-1";
}

export class InMemoryKmsAdapter implements KmsAdapter {
  async encrypt(tenantId: string, plaintext: string): Promise<{ ciphertext: string; keyId: string }> {
    // In production, use AWS KMS or customer-managed key. For contract tests, we use base64.
    const keyId = `alias/${tenantId}-key`;
    const ciphertext = Buffer.from(plaintext, "utf8").toString("base64");
    return { ciphertext, keyId };
  }
  async decrypt(tenantId: string, ciphertext: string): Promise<string> {
    void tenantId;
    return Buffer.from(ciphertext, "base64").toString("utf8");
  }
  async getDataRegion(tenantId: string): Promise<DataRegion> {
    return getTenantDataRegion(tenantId);
  }
}
