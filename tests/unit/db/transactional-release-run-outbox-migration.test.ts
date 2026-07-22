import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationPath = join(process.cwd(), "packages/db/migrations/0017_release_run_outbox_producer.sql");

describe("transactional release-run outbox producer migration", () => {
  it("publishes schema version 17", () => {
    expect(cloudDatabaseSchemaVersion).toBe(17);
  });

  it("atomically creates release-run state and a Check Run effect", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("boardreadyops_enqueue_release_run_with_outbox");
    expect(sql).toContain("update release_runs");
    expect(sql).toContain("update release_run_attempts");
    expect(sql).toContain("insert into release_runs");
    expect(sql).toContain("insert into control_plane_outbox");
    expect(sql).toContain("github.check_run.create");
    expect(sql).toContain("on conflict (idempotency_key)");
    expect(sql).toContain("security invoker");
  });
});
