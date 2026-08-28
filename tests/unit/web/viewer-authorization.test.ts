import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeUserSession, type UserSession } from "../../../apps/web/lib/user-session.js";
import { sessionCookieName, viewerAuthorization } from "../../../apps/web/lib/viewer-authorization.js";
import { __setCookieStore } from "../../stubs/next-headers.js";

const cookieStore = {
  get: vi.fn(),
};

const mockQuery = vi.fn();
const mockClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.ts", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockQuery,
    close: mockClose,
  })),
}));

const secret = "s".repeat(48);
const now = new Date("2026-08-25T12:00:00.000Z");

function makeSession(installationIds: number[]): UserSession {
  return {
    userId: 4711,
    login: "octo-dev",
    installationIds,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
  };
}

describe("viewerAuthorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setCookieStore(() => cookieStore);
  });

  it("denies access when no session cookie is present", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const viewer = await viewerAuthorization({ SESSION_SECRET: secret }, now);

    expect(viewer.session).toBeUndefined();
    expect(await viewer.authorizeInstallation("inst-123")).toBe(false);
    expect(await viewer.authorizeRepository({ installationId: "inst-123" })).toBe(false);
  });

  it("denies access when DATABASE_URL is unset", async () => {
    const token = encodeUserSession(makeSession([1001]), secret);
    cookieStore.get.mockImplementation((name: string) => (name === sessionCookieName ? { value: token } : undefined));

    const viewer = await viewerAuthorization({ SESSION_SECRET: secret }, now);
    expect(viewer.session).toBeDefined();
    expect(await viewer.authorizeInstallation("inst-123")).toBe(false);
  });

  it("authorizes when database returns a matching github_installation_id", async () => {
    const token = encodeUserSession(makeSession([1001, 1002]), secret);
    cookieStore.get.mockImplementation((name: string) => (name === sessionCookieName ? { value: token } : undefined));

    mockQuery.mockResolvedValueOnce({
      rows: [{ github_installation_id: "1001" }],
    });

    const viewer = await viewerAuthorization(
      { SESSION_SECRET: secret, DATABASE_URL: "postgresql://localhost/test" },
      now,
    );

    expect(viewer.session).toBeDefined();
    expect(await viewer.authorizeInstallation("inst-1001")).toBe(true);
    const sql = String(mockQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("github_marketplace_subscriptions");
    expect(sql).toContain("status = 'canceled'");
    expect(sql).toContain(
      "github_marketplace_subscriptions.github_installation_id = installations.github_installation_id",
    );
    expect(mockClose).toHaveBeenCalled();
  });

  it("denies when database returns an installation not in the viewer session", async () => {
    const token = encodeUserSession(makeSession([1001]), secret);
    cookieStore.get.mockImplementation((name: string) => (name === sessionCookieName ? { value: token } : undefined));

    mockQuery.mockResolvedValueOnce({
      rows: [{ github_installation_id: 9999 }],
    });

    const viewer = await viewerAuthorization(
      { SESSION_SECRET: secret, DATABASE_URL: "postgresql://localhost/test" },
      now,
    );

    expect(await viewer.authorizeRepository({ installationId: "inst-9999" })).toBe(false);
  });

  it("denies when database returns no rows or invalid installation id", async () => {
    const token = encodeUserSession(makeSession([1001]), secret);
    cookieStore.get.mockImplementation((name: string) => (name === sessionCookieName ? { value: token } : undefined));

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const viewer = await viewerAuthorization(
      { SESSION_SECRET: secret, DATABASE_URL: "postgresql://localhost/test" },
      now,
    );

    expect(await viewer.authorizeInstallation("inst-unknown")).toBe(false);
  });
});
