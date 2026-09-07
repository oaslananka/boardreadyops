import type { WorkspaceMembershipRecord } from "@boardreadyops/db";
import Link from "next/link";

/**
 * Switches between the workspaces a viewer belongs to.
 *
 * Plain links rather than a select-and-submit: each workspace has a real URL, which is the thing
 * someone pastes to a colleague, and it works with no JavaScript.
 *
 * Renders nothing for a single workspace. A switcher with one option is an affordance that does
 * nothing, so every surface that uses this can call it unconditionally instead of repeating the
 * check -- which is how the two copies of this component drifted apart in the first place.
 */
export function WorkspaceSwitcher({
  workspaces,
  selectedId,
  basePath,
}: Readonly<{
  workspaces: readonly WorkspaceMembershipRecord[];
  selectedId: string;
  /** The surface the switcher navigates within, e.g. `/projects`. */
  basePath: string;
}>) {
  if (workspaces.length < 2) return null;

  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-2">
      {workspaces.map((workspace) => {
        const current = workspace.id === selectedId;
        return (
          <Link
            key={workspace.id}
            href={`${basePath}?workspace=${encodeURIComponent(workspace.id)}`}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-md border px-3 py-2 text-sm md:min-h-9 ${
              current
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
            }`}
          >
            {workspace.name}
          </Link>
        );
      })}
    </nav>
  );
}
