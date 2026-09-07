import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeAuditLogCursor,
  encodeAuditLogCursor,
  loadAuditLog,
  normalizedAuditLogLimit,
  normalizedEventType,
} from "../../../apps/web/lib/audit-log-listing.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const query = vi.fn();
const close = vi.fn();
const listAuditEvents = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query, close })),
}));

vi.mock("@boardreadyops/db/audit-log-store", () => ({
  createSqlAuditLogStore: vi.fn(() => ({ listAuditEvents })),
}));

const session: UserSession = {
  userId: 1,
  login: "octocat",
  installationIds: [42, 77],
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const postgres = { DATABASE_URL: "postgresql://user@localhost:5432/db" };

const event = (id: string, createdAt: string) => ({
  id,
  installationId: "inst_a",
  eventType: "runner.result.recorded",
  actorType: "system",
  subjectType: "release_run",
  metadata: {},
  createdAt,
});

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ id: "inst_a" }, { id: "inst_b" }] });
  close.mockReset();
  listAuditEvents.mockReset().mockResolvedValue([]);
});

describe("cursor encoding", () => {
  it("round-trips", () => {
    const cursor = { createdAt: "2026-09-01T00:00:00.000Z", id: "evt_1" };
    expect(decodeAuditLogCursor(encodeAuditLogCursor(cursor))).toEqual(cursor);
  });

  it("rejects anything malformed rather than throwing", () => {
    expect(decodeAuditLogCursor(undefined)).toBeUndefined();
    expect(decodeAuditLogCursor("")).toBeUndefined();
    expect(decodeAuditLogCursor("not-base64url-json")).toBeUndefined();
    expect(decodeAuditLogCursor(Buffer.from("[]").toString("base64url"))).toBeUndefined();
    expect(decodeAuditLogCursor(Buffer.from('{"createdAt":"nope","id":"a"}').toString("base64url"))).toBeUndefined();
    expect(
      decodeAuditLogCursor(
        Buffer.from(`{"createdAt":"2026-09-01T00:00:00Z","id":"${"a".repeat(129)}"}`).toString("base64url"),
      ),
    ).toBeUndefined();
  });
});

describe("normalizedAuditLogLimit", () => {
  it("clamps to the store's askable range", () => {
    expect(normalizedAuditLogLimit(undefined)).toBe(25);
    expect(normalizedAuditLogLimit(Number.NaN)).toBe(25);
    expect(normalizedAuditLogLimit(0)).toBe(1);
    expect(normalizedAuditLogLimit(10_000)).toBe(50);
  });

  it("never returns a limit whose +1 the store would refuse", () => {
    // The listing asks for one row beyond the page to decide whether there is a next cursor, and
    // the store's own ceiling is 100. A page size of 100 would make that ask throw.
    expect(normalizedAuditLogLimit(100) + 1).toBeLessThanOrEqual(100);
  });
});

describe("normalizedEventType", () => {
  it("keeps a well-formed type and drops anything the column could not hold", () => {
    expect(normalizedEventType("github_app.installation.suspended")).toBe("github_app.installation.suspended");
    expect(normalizedEventType(undefined)).toBeUndefined();
    expect(normalizedEventType("Runner Result")).toBeUndefined();
    expect(normalizedEventType("a".repeat(161))).toBeUndefined();
    expect(normalizedEventType("'; drop table audit_events; --")).toBeUndefined();
  });
});

describe("loadAuditLog", () => {
  it("asks only about installations the session resolved to", async () => {
    await loadAuditLog(session, {}, postgres);

    expect(query.mock.calls[0]?.[1]).toEqual([[42, 77]]);
    expect(listAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ installationId: ["inst_a", "inst_b"] }));
  });

  it("never reads events when the tenant query returns nothing", async () => {
    // A suspended or cancelled installation drops out of that query, and the listing has to stop
    // there rather than fall back to an unscoped read.
    query.mockResolvedValue({ rows: [] });

    await expect(loadAuditLog(session, {}, postgres)).resolves.toEqual({ state: "ok", events: [], next: undefined });
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it("returns a next cursor only when a further row exists", async () => {
    listAuditEvents.mockResolvedValue([event("evt_1", "2026-09-02T00:00:00.000Z")]);
    await expect(loadAuditLog(session, { limit: 1 }, postgres)).resolves.toMatchObject({ next: undefined });

    listAuditEvents.mockResolvedValue([
      event("evt_1", "2026-09-02T00:00:00.000Z"),
      event("evt_2", "2026-09-01T00:00:00.000Z"),
    ]);
    const result = await loadAuditLog(session, { limit: 1 }, postgres);

    expect(result.state === "ok" && result.events).toHaveLength(1);
    expect(result.state === "ok" && decodeAuditLogCursor(result.next ?? null)).toEqual({
      createdAt: "2026-09-02T00:00:00.000Z",
      id: "evt_1",
    });
  });

  it("asks for one row beyond the page", async () => {
    await loadAuditLog(session, { limit: 25 }, postgres);
    expect(listAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: 26 }));
  });

  it("reports signed-out and not-configured without opening a connection", async () => {
    await expect(loadAuditLog(undefined, {}, postgres)).resolves.toEqual({ state: "signed-out" });
    await expect(loadAuditLog(session, {}, {})).resolves.toEqual({ state: "not-configured" });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns nothing for a session carrying no installations", async () => {
    const orphan = { ...session, installationIds: [] };
    await expect(loadAuditLog(orphan, {}, postgres)).resolves.toEqual({ state: "ok", events: [], next: undefined });
    expect(query).not.toHaveBeenCalled();
  });

  it("closes the connection even when the store throws", async () => {
    listAuditEvents.mockRejectedValue(new Error("connection reset"));
    await expect(loadAuditLog(session, {}, postgres)).rejects.toThrow("connection reset");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
