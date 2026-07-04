const endpoints = ["/api/health", "/api/github/webhook", "/api/v1/runs"];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Self-hosted MVP</p>
        <h1>BoardReadyOps Cloud</h1>
        <p className="lede">Self-hosted control plane for BoardReadyOps release checks.</p>
      </section>
      <section className="panel">
        <h2>API surface</h2>
        <ul>
          {endpoints.map((endpoint) => (
            <li key={endpoint}>
              <code>{endpoint}</code>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
