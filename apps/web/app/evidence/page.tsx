export default function EvidencePage() {
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>Releases & Evidence</h1>
          <p>Signed evidence packs bound to review decisions, approvals and artifact digests.</p>
        </div>
      </header>
      <p>
        Evidence packs are deterministic, offline-verifiable, and include base/head SHAs, tool versions, digests and
        decision history.
      </p>
      <pre className="setup-code-preview">boardreadyops release verify --ledger ./evidence-ledger.json</pre>
    </div>
  );
}
