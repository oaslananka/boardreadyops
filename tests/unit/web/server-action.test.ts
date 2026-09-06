import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { idle, ok } from "../../../apps/web/lib/action-result.js";
import { defineAction, formDataToObject } from "../../../apps/web/lib/server-action.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";
import type { ViewerAuthorization } from "../../../apps/web/lib/viewer-authorization.js";

const session = { login: "octocat", installationIds: [] } as unknown as UserSession;

function authorization(value: UserSession | undefined): ViewerAuthorization {
  return {
    session: value,
    authorizeRepository: async () => true,
    authorizeInstallation: async () => true,
  };
}

function form(entries: readonly (readonly [string, string])[]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("formDataToObject", () => {
  it("collapses single values and collects repeated keys into an array", () => {
    expect(
      formDataToObject(
        form([
          ["name", "ci"],
          ["scope", "runs:write"],
          ["scope", "reviews:read"],
        ]),
      ),
    ).toEqual({ name: "ci", scope: ["runs:write", "reviews:read"] });
  });
});

describe("defineAction", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("runs the handler with the parsed input and the resolved session", async () => {
    const handler = vi.fn(async (input: { name: string }) => ok(input.name.toUpperCase(), "Saved."));
    const action = defineAction(schema, handler, { resolveAuthorization: async () => authorization(session) });

    await expect(action(idle, form([["name", "ci"]]))).resolves.toEqual({
      status: "ok",
      data: "CI",
      message: "Saved.",
    });
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ session });
  });

  it("returns field errors without ever calling the handler when the input is invalid", async () => {
    const handler = vi.fn(async () => ok(undefined));
    const action = defineAction(schema, handler, { resolveAuthorization: async () => authorization(session) });

    const result = await action(idle, form([["name", ""]]));
    expect(result.status).toBe("error");
    expect(result).toMatchObject({ fieldErrors: { name: expect.any(Array) } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller before the handler runs", async () => {
    const handler = vi.fn(async () => ok(undefined));
    const action = defineAction(schema, handler, { resolveAuthorization: async () => authorization(undefined) });

    await expect(action(idle, form([["name", "ci"]]))).resolves.toEqual({
      status: "error",
      error: "Sign in to continue.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("converts a thrown error into a result without leaking the message", async () => {
    const action = defineAction(
      schema,
      async () => {
        throw new Error("connection string postgres://user:secret@db/app failed");
      },
      { resolveAuthorization: async () => authorization(session) },
    );

    const result = await action(idle, form([["name", "ci"]]));
    expect(result).toEqual({ status: "error", error: "Something went wrong. Please try again." });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
