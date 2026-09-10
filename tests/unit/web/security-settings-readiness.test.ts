import { describe, expect, it } from "vitest";
import { securitySettingsReadiness } from "../../../apps/web/lib/security-settings-readiness.js";

describe("securitySettingsReadiness", () => {
  it("reports sanitized deployment security readiness without returning secret material", () => {
    const environment = {
      DATABASE_URL: "postgresql://secret-db",
      SESSION_SECRET: "session-secret-value",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: "private-key-value",
      GITHUB_WEBHOOK_SECRET: "webhook-secret-value",
      BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY: "credential-key-value",
      SAML_ENTITY_ID: "urn:boardreadyops:acme",
      SAML_ACS_URL: "https://app.example.test/sso/acs",
      SAML_IDP_METADATA_URL: "https://idp.example.test/metadata",
      SAML_CERTIFICATE: "certificate-value",
    };

    const result = securitySettingsReadiness(environment);
    expect(result.sessionSigning).toEqual({ configured: true });
    expect(result.persistence).toEqual({ configured: true });
    expect(result.githubApp).toEqual({
      appIdConfigured: true,
      privateKeyConfigured: true,
      webhookSecretConfigured: true,
    });
    expect(result.credentialEncryption).toEqual({ configured: true });
    expect(result.saml).toEqual({
      state: "configured",
      entityId: "urn:boardreadyops:acme",
      acsUrl: "https://app.example.test/sso/acs",
      idpMetadataHost: "idp.example.test",
      metadataConfigured: true,
      certificateConfigured: true,
    });
    expect(result.scim).toEqual({ state: "planned" });

    const serialized = JSON.stringify(result);
    for (const secret of [
      "secret-db",
      "session-secret-value",
      "private-key-value",
      "webhook-secret-value",
      "credential-key-value",
      "certificate-value",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("distinguishes incomplete SAML configuration from an unconfigured deployment", () => {
    expect(securitySettingsReadiness({}).saml).toEqual({
      state: "not-configured",
      entityId: undefined,
      acsUrl: undefined,
      idpMetadataHost: undefined,
      metadataConfigured: false,
      certificateConfigured: false,
    });
    expect(securitySettingsReadiness({ SAML_ENTITY_ID: "urn:partial" }).saml.state).toBe("incomplete");
  });
});
