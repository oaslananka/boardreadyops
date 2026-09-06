"use client";

import { type ComponentProps, type ReactNode, useActionState, useEffect, useRef } from "react";
import { type ActionResult, announcementFor, idle } from "../../lib/action-result.js";
import { useToast } from "./toast.js";

export type ActionFormRenderProps<Output> = {
  readonly state: ActionResult<Output>;
  readonly pending: boolean;
};

/**
 * The one way this app submits a mutation: a Server Action through `useActionState`, with the
 * result surfaced as a toast instead of a banner the user has to dismiss by navigating away.
 *
 * Errors are also written into an `aria-live` region, because a toast alone is easy for a screen
 * reader user to miss while focus is still inside the form.
 */
export function ActionForm<Output>({
  action,
  successMessage,
  onSuccess,
  children,
  ...formProps
}: Readonly<
  Omit<ComponentProps<"form">, "action" | "children"> & {
    action: (previous: ActionResult<Output>, formData: FormData) => Promise<ActionResult<Output>>;
    /** Used when the action does not supply its own `message`. */
    successMessage?: string;
    onSuccess?: (data: Output) => void;
    children: (render: ActionFormRenderProps<Output>) => ReactNode;
  }
>) {
  const [state, formAction, pending] = useActionState<ActionResult<Output>, FormData>(action, idle);
  const toast = useToast();
  const announced = useRef<ActionResult<Output>>(idle);

  useEffect(() => {
    if (state === announced.current) return;
    announced.current = state;
    const announcement = announcementFor(state, successMessage);
    if (announcement?.tone === "success") toast.success(announcement.text);
    if (announcement?.tone === "danger") toast.error(announcement.text);
    if (state.status === "ok") onSuccess?.(state.data);
  }, [state, successMessage, onSuccess, toast]);

  return (
    <form action={formAction} {...formProps}>
      {children({ state, pending })}
      <output aria-live="polite" className="sr-only">
        {announcementFor(state, successMessage)?.text ?? ""}
      </output>
    </form>
  );
}
