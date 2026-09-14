"use client";

import { useId, useState } from "react";
import type {
  deleteProjectAction,
  deleteWorkspaceAction,
  renameProjectAction,
  renameWorkspaceAction,
} from "../../app/projects/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

/**
 * Undoing what the create forms on this page made.
 *
 * A workspace or project could be created and then never renamed or removed — a typo in a name
 * was permanent, and a workspace made to try the product stayed in the switcher forever. These
 * are the other half of the two forms that were already here.
 *
 * Deletion asks the caller to type the name rather than clicking yes. `projects`, `revisions` and
 * `deliveries` all cascade from `workspaces`, so a single careless click can take a month of
 * release evidence with it; typing the name is the cheapest control that makes the act
 * deliberate, and the dialog states the counts first so nobody has to guess the blast radius.
 */

type ConfirmDeleteProps = {
  /** Field name the id is posted under. */
  idField: string;
  id: string;
  name: string;
  noun: string;
  /** "3 revisions and 1 delivery link", already phrased. Empty when nothing cascades. */
  cascade: string;
  action: typeof deleteProjectAction | typeof deleteWorkspaceAction;
  trigger: string;
};

function ConfirmDelete({ idField, id, name, noun, cascade, action, trigger }: Readonly<ConfirmDeleteProps>) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const inputId = useId();

  function close() {
    setOpen(false);
    setTyped("");
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="button-delete" onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      {open ? (
        <Dialog titleId={titleId} onClose={close}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Delete “{name}”?
            </h2>
            <p className="text-sm text-muted-foreground">
              {cascade
                ? `This also removes ${cascade}. Anyone holding a delivery link loses access. This cannot be undone.`
                : "This cannot be undone."}
            </p>
            <ActionForm action={action} onSuccess={close} className="flex flex-col gap-3">
              {({ state, pending }) => (
                <>
                  <input type="hidden" name={idField} value={id} />
                  <div>
                    <label htmlFor={inputId} className="text-sm font-medium text-foreground">
                      Type <strong>{name}</strong> to confirm
                    </label>
                    <Input
                      id={inputId}
                      name="confirmName"
                      value={typed}
                      onChange={(event) => setTyped(event.currentTarget.value)}
                      autoComplete="off"
                      className="mt-1 w-full"
                    />
                    {fieldError(state, "confirmName") ? (
                      <p className="mt-1 text-meta text-danger">{fieldError(state, "confirmName")}</p>
                    ) : null}
                  </div>
                  <div className="modal-footer flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={close}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      className="button-delete"
                      // The server re-checks the typed name; this only stops the obvious misfire.
                      disabled={pending || typed !== name}
                    >
                      {pending ? "Deleting…" : `Delete ${noun}`}
                    </Button>
                  </div>
                </>
              )}
            </ActionForm>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

type RenameProps = {
  idField: string;
  id: string;
  currentName: string;
  noun: string;
  action: typeof renameProjectAction | typeof renameWorkspaceAction;
};

function RenameInline({ idField, id, currentName, noun, action }: Readonly<RenameProps>) {
  const [open, setOpen] = useState(false);
  const inputId = useId();

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="button-small" onClick={() => setOpen(true)}>
        Rename
      </Button>
    );
  }

  return (
    <ActionForm action={action} onSuccess={() => setOpen(false)} className="flex flex-wrap items-end gap-2">
      {({ state, pending }) => (
        <>
          <input type="hidden" name={idField} value={id} />
          <div className="min-w-48">
            <label htmlFor={inputId} className="sr-only">
              {noun} name
            </label>
            <Input id={inputId} name="name" defaultValue={currentName} maxLength={128} required className="w-full" />
            {fieldError(state, "name") ? (
              <p className="mt-1 text-meta text-danger">{fieldError(state, "name")}</p>
            ) : null}
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ProjectRowActions({
  projectId,
  projectName,
  revisions,
  deliveries,
  canRename,
  canDelete,
  renameAction,
  deleteAction,
}: Readonly<{
  projectId: string;
  projectName: string;
  revisions: number;
  deliveries: number;
  canRename: boolean;
  canDelete: boolean;
  renameAction: typeof renameProjectAction;
  deleteAction: typeof deleteProjectAction;
}>) {
  if (!canRename && !canDelete) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canRename ? (
        <RenameInline
          idField="projectId"
          id={projectId}
          currentName={projectName}
          noun="Project"
          action={renameAction}
        />
      ) : null}
      {canDelete ? (
        <ConfirmDelete
          idField="projectId"
          id={projectId}
          name={projectName}
          noun="project"
          cascade={cascadePhrase([
            [revisions, "revision"],
            [deliveries, "delivery link"],
          ])}
          action={deleteAction}
          trigger="Delete"
        />
      ) : null}
    </div>
  );
}

export function WorkspaceDangerZone({
  workspaceId,
  workspaceName,
  projects,
  revisions,
  deliveries,
  canRename,
  canDelete,
  renameAction,
  deleteAction,
}: Readonly<{
  workspaceId: string;
  workspaceName: string;
  projects: number;
  revisions: number;
  deliveries: number;
  canRename: boolean;
  canDelete: boolean;
  renameAction: typeof renameWorkspaceAction;
  deleteAction: typeof deleteWorkspaceAction;
}>) {
  if (!canRename && !canDelete) return null;
  return (
    <div className="flex flex-col gap-4">
      {canRename ? (
        <div>
          <h3 className="text-sm font-bold text-foreground">Workspace name</h3>
          <p className="mb-2 text-meta text-muted-foreground">
            Shown in the switcher and on every project beneath it. The slug does not change.
          </p>
          <RenameInline
            idField="workspaceId"
            id={workspaceId}
            currentName={workspaceName}
            noun="Workspace"
            action={renameAction}
          />
        </div>
      ) : null}

      {canDelete ? (
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-bold text-foreground">Delete this workspace</h3>
          <p className="mb-2 text-meta text-muted-foreground">
            Removes the workspace and everything beneath it:{" "}
            {cascadePhrase([
              [projects, "project"],
              [revisions, "revision"],
              [deliveries, "delivery link"],
            ]) || "nothing else yet"}
            .
          </p>
          <ConfirmDelete
            idField="workspaceId"
            id={workspaceId}
            name={workspaceName}
            noun="workspace"
            cascade={cascadePhrase([
              [projects, "project"],
              [revisions, "revision"],
              [deliveries, "delivery link"],
            ])}
            action={deleteAction}
            trigger="Delete workspace"
          />
        </div>
      ) : null}
    </div>
  );
}

/** "3 projects, 12 revisions and 1 delivery link", skipping anything at zero. */
function cascadePhrase(parts: readonly (readonly [number, string])[]): string {
  const present = parts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`);
  if (present.length === 0) return "";
  if (present.length === 1) return present[0] ?? "";
  return `${present.slice(0, -1).join(", ")} and ${present.at(-1)}`;
}
