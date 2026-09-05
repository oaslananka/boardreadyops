export const metadata = {
  title: "Data & Retention",
};

export default function DataSettingsPage() {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-lg">
      <header>
        <h2 className="text-lg font-bold text-foreground">Data & Retention</h2>
        <p className="mt-1 text-sm text-muted-foreground">Retention policies, legal holds, exports and erasures.</p>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Free</dt>
          <dd className="mt-1 text-sm text-foreground">30 days</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team</dt>
          <dd className="mt-1 text-sm text-foreground">365 days</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business</dt>
          <dd className="mt-1 text-sm text-foreground">Configurable; legal hold blocks deletion</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source retention</dt>
          <dd className="mt-1 text-sm text-foreground">24 hours after job (derived snapshots follow plan retention)</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Uninstall gives 30-day export window; immediate delete or legal hold can override. Exports are async, signed and
        time-limited.
      </p>
    </div>
  );
}
