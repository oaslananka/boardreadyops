import { notFound } from "next/navigation";
import { AttemptsView, RunPageFrame, RunUnavailable } from "../../../../components/run-investigation.js";
import { loadRunDashboard } from "../../../../lib/run-dashboard.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{ params: Promise<{ runId: string }> }>;

export default async function AttemptsPage({ params }: PageProps) {
  const { runId } = await params;
  const result = await loadRunDashboard(runId);
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  return (
    <RunPageFrame run={result.run} active="attempts">
      <AttemptsView run={result.run} />
    </RunPageFrame>
  );
}
