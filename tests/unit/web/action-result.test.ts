import { describe, expect, it } from "vitest";
import { announcementFor, fail, fieldError, fromIssues, idle, ok } from "../../../apps/web/lib/action-result.js";

describe("ActionResult", () => {
  it("starts idle and carries data on success", () => {
    expect(idle).toEqual({ status: "idle" });
    expect(ok({ id: "tok_1" }, "Token created.")).toEqual({
      status: "ok",
      data: { id: "tok_1" },
      message: "Token created.",
    });
  });

  it("omits an absent message rather than setting it undefined", () => {
    // exactOptionalPropertyTypes is on, so an explicit `message: undefined` would not type-check
    // for consumers reading `state.message`.
    expect(Object.hasOwn(ok(undefined) as object, "message")).toBe(false);
    expect(Object.hasOwn(fail("nope") as object, "fieldErrors")).toBe(false);
  });

  it("groups zod-shaped issues by field path, keeping the first message as the summary", () => {
    const result = fromIssues([
      { path: ["name"], message: "Name is required." },
      { path: ["scopes"], message: "Pick at least one scope." },
      { path: ["scopes"], message: "Unknown scope." },
    ]);

    expect(result).toMatchObject({ status: "error", error: "Name is required." });
    expect(fieldError(result, "scopes")).toBe("Pick at least one scope.");
    expect(fieldError(result, "name")).toBe("Name is required.");
    expect(fieldError(result, "missing")).toBeUndefined();
  });

  it("files a path-less issue under a stable key instead of an empty string", () => {
    const result = fromIssues([{ path: [], message: "Request was not understood." }]);
    expect(fieldError(result, "_")).toBe("Request was not understood.");
  });

  it("reads no field errors from a non-error result", () => {
    expect(fieldError(ok(undefined), "name")).toBeUndefined();
    expect(fieldError(idle, "name")).toBeUndefined();
  });

  it("announces an action's own message ahead of the caller's fallback", () => {
    expect(announcementFor(ok(undefined, "Token revoked."), "Saved.")).toEqual({
      tone: "success",
      text: "Token revoked.",
    });
    expect(announcementFor(ok(undefined), "Saved.")).toEqual({ tone: "success", text: "Saved." });
  });

  it("announces failures as danger and says nothing while idle or silent", () => {
    expect(announcementFor(fail("Name is taken."))).toEqual({ tone: "danger", text: "Name is taken." });
    expect(announcementFor(idle, "Saved.")).toBeUndefined();
    expect(announcementFor(ok(undefined))).toBeUndefined();
  });
});
