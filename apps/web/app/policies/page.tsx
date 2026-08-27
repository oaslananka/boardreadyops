import PoliciesClient from "./policies-client.js";

export default function PoliciesPage() {
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>Organization Policies</h1>
          <p>Inheritance: Organization → Team → Repository → Review exception. No hidden precedence.</p>
        </div>
      </header>
      <p className="cell-note">
        Policy updates run a dry-run impact preview before enforcement. Expired waivers block production releases.
      </p>
      <PoliciesClient />
    </div>
  );
}
