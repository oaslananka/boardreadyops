export type SamlConfig = {
  entityId: string;
  acsUrl: string;
  idpMetadataUrl: string;
  certificate: string;
};

export type SamlSession = {
  userId: string;
  email: string;
  nameId: string;
  sessionIndex: string;
  expiresAt: string;
};

export interface SamlAdapter {
  getConfig(tenantId: string): Promise<SamlConfig | null>;
  validateAssertion(samlResponse: string): Promise<SamlSession>;
  initiateLogout(session: SamlSession): Promise<string>;
}

export function getSamlEnvConfig(): SamlConfig | null {
  const entityId = process.env.SAML_ENTITY_ID;
  const acsUrl = process.env.SAML_ACS_URL;
  const idpMetadataUrl = process.env.SAML_IDP_METADATA_URL;
  const certificate = process.env.SAML_CERTIFICATE;
  if (!entityId || !acsUrl || !idpMetadataUrl || !certificate) return null;
  return { entityId, acsUrl, idpMetadataUrl, certificate };
}

export class InMemorySamlAdapter implements SamlAdapter {
  private readonly configs = new Map<string, SamlConfig>();
  async getConfig(tenantId: string): Promise<SamlConfig | null> {
    return this.configs.get(tenantId) ?? getSamlEnvConfig();
  }
  async validateAssertion(samlResponse: string): Promise<SamlSession> {
    if (!samlResponse || samlResponse.length < 10) throw new Error("Invalid SAML response");
    // In test/sandbox, treat base64-encoded JSON as assertion for contract testing
    try {
      const decoded = Buffer.from(samlResponse, "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as SamlSession;
      if (parsed.email && parsed.userId) return parsed;
    } catch {
      // fall through to mock
    }
    return {
      userId: `saml_${Date.now()}`,
      email: "user@example.com",
      nameId: "nameId",
      sessionIndex: `sess_${Date.now()}`,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    };
  }
  async initiateLogout(session: SamlSession): Promise<string> {
    return `https://idp.example.com/logout?session=${session.sessionIndex}`;
  }
}
