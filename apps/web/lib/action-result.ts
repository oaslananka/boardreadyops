/**
 * The single shape every Server Action in this app returns.
 *
 * Before this existed there were three incompatible mutation styles — client `fetch` plus manual
 * state, native form POST plus a `?status=` redirect, and GET forms driving `searchParams` — and
 * three verbatim copies of the same inline error/success banner. `ActionResult` is what lets
 * `ActionForm` render feedback for all of them the same way.
 */

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export type ActionResult<T = void> =
  | { readonly status: "idle" }
  | { readonly status: "ok"; readonly data: T; readonly message?: string }
  | { readonly status: "error"; readonly error: string; readonly fieldErrors?: FieldErrors };

export const idle: ActionResult<never> = { status: "idle" };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return message === undefined ? { status: "ok", data } : { status: "ok", data, message };
}

export function fail(error: string, fieldErrors?: FieldErrors): ActionResult<never> {
  return fieldErrors === undefined ? { status: "error", error } : { status: "error", error, fieldErrors };
}

/** Reads one field's first message, for rendering next to the control that produced it. */
export function fieldError(result: ActionResult<unknown>, field: string): string | undefined {
  if (result.status !== "error") return undefined;
  return result.fieldErrors?.[field]?.[0];
}

type ZodLikeIssue = { readonly path: readonly (string | number | symbol)[]; readonly message: string };

/**
 * Structural rather than importing zod's type, so this module stays dependency-free and testable
 * without constructing a real ZodError.
 */
export function fromIssues(
  issues: readonly ZodLikeIssue[],
  fallback = "Check the highlighted fields.",
): ActionResult<never> {
  const grouped: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    const bucket = grouped[key] ?? [];
    bucket.push(issue.message);
    grouped[key] = bucket;
  }
  const first = issues[0]?.message;
  return fail(first ?? fallback, grouped);
}

export type Announcement = { readonly tone: "success" | "danger"; readonly text: string };

/**
 * What a completed action should say, for both the toast and the form's live region.
 *
 * Split out of `ActionForm` so the decision is testable on its own: React 19 form actions are not
 * reliably driveable in happy-dom, and this is the part worth pinning.
 */
export function announcementFor(result: ActionResult<unknown>, successMessage?: string): Announcement | undefined {
  if (result.status === "error") return { tone: "danger", text: result.error };
  if (result.status !== "ok") return undefined;
  const text = result.message ?? successMessage;
  return text ? { tone: "success", text } : undefined;
}
