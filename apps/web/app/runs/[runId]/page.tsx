export const dynamic = "force-dynamic";

type RunPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Release readiness run</p>
        <h1>BoardReadyOps run</h1>
        <p className="lede">This run was created by the GitHub App and dispatched to the readiness runner workflow.</p>
      </section>
      <section className="panel">
        <h2>Run status</h2>
        <p>
          <strong>Run ID:</strong> <code>{runId}</code>
        </p>
        <p>This page confirms that the dashboard route exists while the detailed run view is being expanded.</p>
      </section>
    </main>
  );
}
