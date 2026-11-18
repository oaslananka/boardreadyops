"use client";

import { useId } from "react";
import type { createProjectAction, createWorkspaceAction } from "../../app/projects/actions.js";
import { fieldError } from "../../lib/action-result.js";
import type { RepositorySummary } from "../../lib/repository-dashboard.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

/**
 * A slug suggestion, not a slug. The field stays editable because the generated value is only a
 * guess at what the user wants in their URLs, and it is unique-checked server-side either way.
 */
export function suggestSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      // Two single-character replaces rather than `/^-+|-+$/`: the collapse above already
      // guarantees at most one hyphen at each end, so there is nothing for a quantifier to match
      // and nothing to backtrack over -- and an anchor inside an alternation reads like a bug
      // even when it is not.
      .replace(/^-/u, "")
      .replace(/-$/u, "")
      .slice(0, 64)
  );
}

export function CreateWorkspaceForm({ action }: Readonly<{ action: typeof createWorkspaceAction }>) {
  const nameId = useId();
  const slugId = useId();

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {({ state, pending }) => (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={nameId}>
              Workspace name
            </label>
            <Input
              id={nameId}
              name="name"
              maxLength={128}
              required
              placeholder="Acme Hardware"
              aria-describedby={fieldError(state, "name") ? `${nameId}-error` : undefined}
              onChange={(event) => {
                // Only fills a slug the user has not typed into, so it never fights them.
                const form = event.currentTarget.form;
                const slug = form?.elements.namedItem("slug");
                if (slug instanceof HTMLInputElement && slug.dataset.touched !== "true") {
                  slug.value = suggestSlug(event.currentTarget.value);
                }
              }}
            />
            {fieldError(state, "name") ? (
              <p id={`${nameId}-error`} className="text-meta text-danger">
                {fieldError(state, "name")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={slugId}>
              URL slug
            </label>
            <Input
              id={slugId}
              name="slug"
              maxLength={64}
              required
              pattern="[a-z0-9-]+"
              placeholder="acme-hardware"
              onInput={(event) => {
                event.currentTarget.dataset.touched = "true";
              }}
              aria-describedby={`${slugId}-hint`}
            />
            <p id={`${slugId}-hint`} className="text-meta text-muted-foreground">
              Lowercase letters, numbers and hyphens. Used in workspace URLs and cannot be changed later.
            </p>
            {fieldError(state, "slug") ? <p className="text-meta text-danger">{fieldError(state, "slug")}</p> : null}
          </div>

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function CreateProjectForm({
  workspaceId,
  action,
  repositories,
  repositoryListUnavailable,
}: Readonly<{
  workspaceId: string;
  action: typeof createProjectAction;
  repositories: readonly Pick<RepositorySummary, "owner" | "name" | "private">[];
  repositoryListUnavailable: boolean;
}>) {
  const nameId = useId();
  const formatId = useId();
  const descriptionId = useId();
  const repositoryId = useId();

  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3">
      {({ state, pending }) => (
        <>
          {/* Re-authorized server-side against the caller's membership; a hidden input is a
              suggestion, not a permission. */}
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={nameId}>
              Project name
            </label>
            <Input id={nameId} name="name" maxLength={128} required placeholder="Gateway board" />
            {fieldError(state, "name") ? <p className="text-meta text-danger">{fieldError(state, "name")}</p> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={descriptionId}>
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id={descriptionId} name="description" maxLength={1024} placeholder="What this board does" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={formatId}>
              CAD format
            </label>
            <NativeSelect id={formatId} name="defaultCadFormat" defaultValue="kicad">
              <option value="kicad">KiCad</option>
              <option value="altium">Altium</option>
              <option value="easyeda">EasyEDA</option>
              <option value="fusion360">Fusion 360</option>
              <option value="ipc2581">IPC-2581</option>
              <option value="generic_gerber">Gerber package</option>
            </NativeSelect>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={repositoryId}>
              GitHub repository <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <NativeSelect id={repositoryId} name="githubRepoFullName" defaultValue="">
              <option value="">No repository linked</option>
              {repositories.map((repository) => (
                <option key={`${repository.owner}/${repository.name}`} value={`${repository.owner}/${repository.name}`}>
                  {repository.owner}/{repository.name}
                  {repository.private ? " (private)" : ""}
                </option>
              ))}
            </NativeSelect>
            <p className="max-w-md text-meta text-muted-foreground">
              {repositoryListUnavailable
                ? "GitHub repository access could not be verified. Try again later; you can still create an unlinked project."
                : repositories.length > 0
                  ? "Linking a repository brings its currently stored, signed manufacturing archives into Deliveries. Temporary GitHub Actions artifacts stay inspect-only."
                  : "No GitHub repositories are available to link. Connect one from GitHub repositories first."}
            </p>
            {fieldError(state, "githubRepoFullName") ? (
              <p className="text-meta text-danger">{fieldError(state, "githubRepoFullName")}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Add project"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
