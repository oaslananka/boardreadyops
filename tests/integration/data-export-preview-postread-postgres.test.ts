import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const { Pool } = pg;
const viewerAuthorization = vi.hoisted(() => vi.fn());
const resolveTenant = vi.hoisted(() => vi.fn());
const persistence = vi.hoisted(() => vi.fn());
const createPgQueryExecutor = vi.hoisted(() => vi.fn());

vi.mock("../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization }));
vi.mock("../../apps/web/lib/settings-tenant.js", () => ({ resolveSettingsTenantScope: resolveTenant }));
vi.mock("../../apps/web/lib/cloud-runtime-config.js", () => ({ resolveCloudPersistenceConfiguration: persistence }));
vi.mock("@boardreadyops/db/pg-executor", () => ({ createPgQueryExecutor }));

import { GET } from "../../apps/web/app/api/v1/data-exports/[exportId]/route.js";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const db = connectionString ? new Pool({ connectionString, max: 3 }) : undefined;
const tenant = `preview-${randomUUID()}`;
const installationId = randomUUID();
const repositoryId = randomUUID();
const exportId = randomUUID();
const bytes = Buffer.from('{"kind":"boardreadyops.repository-metadata-export","version":1}');
const sha256 = createHash("sha256").update(bytes).digest("hex");
const url = `https://boardreadyops.test/api/v1/data-exports/${exportId}?installationId=${installationId}&download=metadata-manifest`;
const context = { params: Promise.resolve({ exportId }) };
let afterFirstRead: (() => Promise<unknown>) | undefined;
let previewReads = 0;

function pool() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}

beforeAll(async () => {
  if (!db) return;
  await pool().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES ($1,$2,$3,'Organization')",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  await pool().query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES ($1,$2,$3,$4,'preview-check','main')",
    [repositoryId, installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  await pool().query(
    `INSERT INTO data_exports (
       id,tenant_id,installation_id,requested_by,status,scope,scope_id,
       prepared_manifest_bytes,prepared_manifest_sha256,prepared_manifest_at,manifest_preview_expires_at
     ) VALUES ($1,$2,$3,'operator','running','repository',$4,$5,$6,NOW(),NOW()+interval '10 minutes')`,
    [exportId, tenant, installationId, repositoryId, bytes, sha256],
  );
});

beforeEach(async () => {
  if (!db) return;
  vi.clearAllMocks();
  afterFirstRead = undefined;
  previewReads = 0;
  viewerAuthorization.mockResolvedValue({ session: { login: "operator", userId: 42 } });
  resolveTenant.mockResolvedValue({ selected: { id: installationId, accountLogin: tenant } });
  persistence.mockReturnValue({ mode: "postgres", databaseUrl: connectionString });
  await pool().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [installationId]);
  await pool().query("UPDATE repositories SET disabled_at=NULL WHERE id=$1", [repositoryId]);
  await pool().query(
    `UPDATE data_exports SET prepared_manifest_bytes=$2,prepared_manifest_sha256=$3,
     manifest_preview_expires_at=NOW()+interval '10 minutes',manifest_preview_revoked_at=NULL WHERE id=$1`,
    [exportId, bytes, sha256],
  );
  createPgQueryExecutor.mockImplementation(() => ({
    async query(sql: string, parameters?: readonly unknown[]) {
      const result = await pool().query(sql, parameters ? [...parameters] : []);
      if (sql.includes("data_exports.manifest_preview_expires_at > NOW()")) {
        previewReads += 1;
        if (previewReads === 1) await afterFirstRead?.();
      }
      return result;
    },
    async close() {},
  }));
});

afterAll(async () => {
  if (!db) return;
  try {
    await pool().query("DELETE FROM data_exports WHERE id=$1", [exportId]);
    await pool().query("DELETE FROM installations WHERE id=$1", [installationId]);
  } finally {
    await pool().end();
  }
});

describeDatabase("metadata preview post-read admission with PostgreSQL 17", () => {
  it("returns the original requester's preview while the installation and record remain live", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(previewReads).toBe(2);
    const state = await pool().query("SELECT status,download_url,completed_at FROM data_exports WHERE id=$1", [
      exportId,
    ]);
    expect(state.rows[0]).toMatchObject({ status: "running", download_url: null, completed_at: null });
  });

  it.each([
    [
      "preview-revoked",
      () => pool().query("UPDATE data_exports SET manifest_preview_revoked_at=NOW() WHERE id=$1", [exportId]),
    ],
    [
      "preview-expired",
      () =>
        pool().query("UPDATE data_exports SET manifest_preview_expires_at=NOW()-interval '1 second' WHERE id=$1", [
          exportId,
        ]),
    ],
    [
      "installation-suspended",
      () => pool().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installationId]),
    ],
    [
      "repository-disabled",
      () => pool().query("UPDATE repositories SET disabled_at=NOW() WHERE id=$1", [repositoryId]),
    ],
  ] as const)("denies the already-read bytes when %s between reads", async (_case, change) => {
    afterFirstRead = change;
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(previewReads).toBe(2);
  });

  it("denies an already-read version when the persisted manifest is replaced", async () => {
    const changed = Buffer.from('{"kind":"boardreadyops.repository-metadata-export","version":2}');
    const digest = createHash("sha256").update(changed).digest("hex");
    afterFirstRead = () =>
      pool().query("UPDATE data_exports SET prepared_manifest_bytes=$2,prepared_manifest_sha256=$3 WHERE id=$1", [
        exportId,
        changed,
        digest,
      ]);
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(previewReads).toBe(2);
  });
});
