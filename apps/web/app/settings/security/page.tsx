export const metadata = {
  title: "Security & Access",
};

export default function SecuritySettingsPage() {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-lg">
      <header>
        <h2 className="text-lg font-bold text-foreground">Security</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          SAML SSO, SCIM provisioning, audit export and SIEM streaming.
        </p>
      </header>
      <p className="mt-3 text-sm text-foreground">
        SAML is available on Business and Enterprise. SCIM deprovisions revoke sessions immediately and orphan
        assignments for reassignment.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Configure SAML via environment: SAML_ENTITY_ID, SAML_ACS_URL, SAML_IDP_METADATA_URL, SAML_CERTIFICATE. SCIM
        requires external provider tenant.
      </p>
    </div>
  );
}
