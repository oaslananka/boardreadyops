import { resolveEffectivePolicy } from "@boardreadyops/cloud-core";

export default function PoliciesPage() {
  // Demo policy inheritance visualization
  const demo = resolveEffectivePolicy({ organization: null, team: null, repository: null, exception: null });
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>Organization Policies</h1>
          <p>Inheritance: Organization → Team → Repository → Review exception. No hidden precedence.</p>
        </div>
      </header>
      <p>Effective policy: {demo.effective ? demo.effective.name : "No policy configured (defaults to open review)"}</p>
      <p className="cell-note">
        Policy updates run a dry-run impact preview before enforcement. Expired waivers block production releases.
      </p>
    </div>
  );
}
