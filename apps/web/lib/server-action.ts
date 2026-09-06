import type { z } from "zod";
import { type ActionResult, fail, fromIssues } from "./action-result.js";
import type { UserSession } from "./user-session.js";
import { type ViewerAuthorization, viewerAuthorization } from "./viewer-authorization.js";

type ActionContext = {
  readonly session: UserSession;
  readonly authorization: ViewerAuthorization;
};

export type ActionHandler<Input, Output> = (input: Input, context: ActionContext) => Promise<ActionResult<Output>>;

/** Reads a FormData into the plain object shape a zod schema expects, collecting repeated keys. */
export function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const entries: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const existing = entries[key];
    if (existing === undefined) entries[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else entries[key] = [existing, value];
  }
  return entries;
}

/**
 * Wraps a handler into the `(previousState, formData) => nextState` signature `useActionState`
 * expects: parse, authenticate, run, and turn anything thrown into a plain error result rather
 * than leaking a stack trace to the client.
 *
 * Two rules callers must follow:
 *
 * 1. **Define actions as top-level exports of an `app/**\/actions.ts` module and capture nothing
 *    from the enclosing scope** — every value comes from the FormData. Closures over server
 *    scope take Next's encrypted-closure path, which needs a stable
 *    `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` shared by every replica; without one, multi-replica
 *    deploys fail to decrypt actions intermittently.
 * 2. **Keep the handler itself in `app/`, not `lib/`.** The coverage gate measures
 *    `apps/web/lib/**` and `apps/web/app/api/**`; pure helpers belong in `lib/` and get tested,
 *    database-touching handlers do not drag that number down from `app/`.
 */
export function defineAction<Schema extends z.ZodType, Output>(
  schema: Schema,
  handler: ActionHandler<z.infer<Schema>, Output>,
  options: { readonly resolveAuthorization?: () => Promise<ViewerAuthorization> } = {},
): (previous: ActionResult<Output>, formData: FormData) => Promise<ActionResult<Output>> {
  const resolveAuthorization = options.resolveAuthorization ?? (() => viewerAuthorization());

  return async (_previous, formData) => {
    const parsed = schema.safeParse(formDataToObject(formData));
    if (!parsed.success) return fromIssues(parsed.error.issues);

    const authorization = await resolveAuthorization();
    if (!authorization.session) return fail("Sign in to continue.");

    try {
      return await handler(parsed.data, { session: authorization.session, authorization });
    } catch {
      // The real error is already on the server log via the caller's own instrumentation; the
      // client gets a message it can act on and nothing about the internals.
      return fail("Something went wrong. Please try again.");
    }
  };
}
