export type SecuritySettingsReadiness = {
  sessionSigning: { configured: boolean };
  persistence: { configured: boolean };
  githubApp: { appIdConfigured: boolean; privateKeyConfigured: boolean; webhookSecretConfigured: boolean };
  credentialEncryption: { configured: boolean };
  saml: {
    state: "configured" | "incomplete" | "not-configured";
    entityId: string | undefined;
    acsUrl: string | undefined;
    idpMetadataHost: string | undefined;
    metadataConfigured: boolean;
    certificateConfigured: boolean;
  };
  scim: { state: "planned" };
};

function configured(value: string | undefined): boolean {
  return (value?.trim().length ?? 0) > 0;
}

export function securitySettingsReadiness(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SecuritySettingsReadiness {
  const entityId = environment.SAML_ENTITY_ID?.trim() || undefined;
  const acsUrl = environment.SAML_ACS_URL?.trim() || undefined;
  const idpMetadataUrl = environment.SAML_IDP_METADATA_URL?.trim() || undefined;
  let idpMetadataHost: string | undefined;
  if (idpMetadataUrl) {
    try {
      idpMetadataHost = new URL(idpMetadataUrl).host || undefined;
    } catch {
      idpMetadataHost = undefined;
    }
  }
  const certificateConfigured = configured(environment.SAML_CERTIFICATE);
  const samlParts = [entityId !== undefined, acsUrl !== undefined, idpMetadataUrl !== undefined, certificateConfigured];
  const samlState = samlParts.every(Boolean) ? "configured" : samlParts.some(Boolean) ? "incomplete" : "not-configured";

  return {
    sessionSigning: { configured: configured(environment.SESSION_SECRET) },
    persistence: { configured: configured(environment.DATABASE_URL) },
    githubApp: {
      appIdConfigured: configured(environment.GITHUB_APP_ID),
      privateKeyConfigured: configured(environment.GITHUB_APP_PRIVATE_KEY),
      webhookSecretConfigured: configured(environment.GITHUB_WEBHOOK_SECRET),
    },
    credentialEncryption: { configured: configured(environment.BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY) },
    saml: {
      state: samlState,
      entityId,
      acsUrl,
      idpMetadataHost,
      metadataConfigured: idpMetadataUrl !== undefined,
      certificateConfigured,
    },
    scim: { state: "planned" },
  };
}
