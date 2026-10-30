import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const mocks = vi.hoisted(() => ({
  resolveTenant: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
  createPgQueryExecutor: vi.fn(),
}));

vi.mock("../../../apps/web/lib/settings-tenant.js", () => ({
  resolveSettingsTenantScope: mocks.resolveTenant,
}));
vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: mocks.createPgQueryExecutor,
}));

import { requestExportForViewer } from "../../../apps/web/lib/data-settings-admin.js";

const session = { userId: 7, login: "operator", installationIds: [42] } as unknown as UserSession;

describe("default data settings export store wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgres://disposable.invalid/fixture");
    mocks.resolveTenant.mockResolvedValue({
      selected: { id: "installation-a", accountLogin: "tenant-a", planTier: "business" },
      installations: [{ id: "installation-a", accountLogin: "tenant-a", planTier: "business" }],
    });
    mocks.close.mockResolvedValue(undefined);
    mocks.createPgQueryExecutor.mockReturnValue({ query: mocks.query, close: mocks.close });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the real SQL-scoped preparation store for the default repository export action", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: "export-a" }] });
    const result = await requestExportForViewer(session, {
      installationId: "installation-a",
      scope: "repository",
      scopeId: "repo-a",
    });
    expect(result).toMatchObject({ status: "ok", data: { exportId: "export-a", status: "pending" } });
    expect(mocks.resolveTenant).toHaveBeenCalledWith(session, "installation-a");
    expect(mocks.createPgQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgres://disposable.invalid/fixture",
      max: 1,
    });
    expect(mocks.query).toHaveBeenCalledOnce();
    const [sql, params] = mocks.query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain("lower(account_login) = lower($3)");
    expect(sql).toContain("repositories.installation_id = owned_installation.id");
    expect(sql).toContain("repositories.disabled_at IS NULL");
    expect(params.slice(1)).toEqual(["installation-a", "tenant-a", "operator", "repository", "repo-a"]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("fails closed and releases the database connection when an installation is no longer eligible", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const result = await requestExportForViewer(session, {
      installationId: "installation-a",
      scope: "organization",
    });
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.query).toHaveBeenCalledOnce();
    const [sql, params] = mocks.query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain("suspended_at IS NULL");
    expect(params.slice(1)).toEqual(["installation-a", "tenant-a", "operator", "organization", null]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
