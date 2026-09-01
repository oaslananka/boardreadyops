export const metadata = {
  title: "Security & Access",
};

export default function SecuritySettingsPage() {
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h2>Security</h2>
          <p>SAML SSO, SCIM provisioning, audit export and SIEM streaming.</p>
        </div>
      </header>
      <p>
        SAML is available on Business and Enterprise. SCIM deprovisions revoke sessions immediately and orphan
        assignments for reassignment.
      </p>
      <p className="cell-note">
        Configure SAML via environment: SAML_ENTITY_ID, SAML_ACS_URL, SAML_IDP_METADATA_URL, SAML_CERTIFICATE. SCIM
        requires external provider tenant.
      </p>
    </div>
  );
}
