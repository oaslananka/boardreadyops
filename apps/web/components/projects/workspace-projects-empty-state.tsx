import Link from "next/link";
import { EmptyState } from "../ui.js";

/**
 * Workspace projects are optional organizational records. A viewer with a
 * recorded GitHub App run can inspect the run without first creating one.
 * Run access is independently reauthorized on the destination page.
 */
export function WorkspaceProjectsEmptyState({
  recordedRunId,
  hasAnyProjects = false,
}: Readonly<{ recordedRunId?: string; hasAnyProjects?: boolean }>) {
  if (hasAnyProjects) {
    return (
      <EmptyState
        title="No projects on this page"
        action={
          <Link href="/projects" className="inline-flex min-h-11 items-center font-medium text-primary underline">
            Return to your projects
          </Link>
        }
      >
        <p>There are projects in this workspace, but none on the current page.</p>
      </EmptyState>
    );
  }

  return (
    <EmptyState
      title="No CAD workspace projects yet"
      action={
        <Link
          href={recordedRunId ? `/runs/${encodeURIComponent(recordedRunId)}/design` : "/setup"}
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {recordedRunId ? "Inspect recorded design" : "Review repository setup"}
        </Link>
      }
    >
      {recordedRunId ? (
        <p>
          Your GitHub repository already has published design evidence. Open the recorded PCB or schematic without
          creating a CAD workspace project. The recording is not manufacturing approval. Create a workspace project
          later only if you want to group board revisions here.
        </p>
      ) : (
        <p>
          To inspect hardware findings, connect a GitHub repository and run a check from Setup. Creating a CAD workspace
          project is optional; it does not automatically create a repository run or import GitHub evidence.
        </p>
      )}
    </EmptyState>
  );
}
