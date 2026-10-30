import type { RefinementCtx } from "zod";

/** Apply the same canonical scope contract to every lifecycle request endpoint. */
export function lifecycleScopeRefinement(requestType: "export" | "erasure") {
  return (
    data: { scope: "organization" | "repository" | "user"; scopeId?: string | undefined },
    ctx: RefinementCtx,
  ): void => {
    if (data.scope === "organization") {
      if (data.scopeId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["scopeId"],
          message: `Organization ${requestType} must not have a scope id.`,
        });
      }
    } else if (!data.scopeId?.trim() || data.scopeId !== data.scopeId.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["scopeId"],
        message: `Repository and user ${requestType}s require a canonical scope id.`,
      });
    }
  };
}
