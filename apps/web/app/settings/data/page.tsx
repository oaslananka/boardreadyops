export default function DataSettingsPage() {
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h2>Data & Retention</h2>
          <p>Retention policies, legal holds, exports and erasures.</p>
        </div>
      </header>
      <dl className="definition-grid">
        <div>
          <dt>Free</dt>
          <dd>30 days</dd>
        </div>
        <div>
          <dt>Team</dt>
          <dd>365 days</dd>
        </div>
        <div>
          <dt>Business</dt>
          <dd>Configurable; legal hold blocks deletion</dd>
        </div>
        <div>
          <dt>Source retention</dt>
          <dd>24 hours after job (derived snapshots follow plan retention)</dd>
        </div>
      </dl>
      <p className="cell-note">
        Uninstall gives 30-day export window; immediate delete or legal hold can override. Exports are async, signed and
        time-limited.
      </p>
    </div>
  );
}
