import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleGuestManufacturingDownload,
  lookupGuestManufacturingArtifact,
} from "../../../apps/web/lib/guest-manufacturing-download.js";

const validToken = "a".repeat(64);
const roots: string[] = [];

function record(content: Buffer) {
  return {
    id: "art_fixture",
    run_id: "run_fixture",
    name: "board-production.zip",
    kind: "archive",
    role: "manufacturing",
    storage_path: "run_fixture/archive.bin",
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
    repository_id: "repo_fixture",
    installation_id: "installation_fixture",
  };
}

async function fixture(content = Buffer.from("PK-real-fixture-manufacturing-archive")) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bro-guest-fab-"));
  roots.push(root);
  await mkdir(path.join(root, "run_fixture"), { recursive: true });
  await writeFile(path.join(root, "run_fixture", "archive.bin"), content);
  return { root, content };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("token-bound first-party manufacturing download", () => {
  it("streams exactly the persisted manufacturing file and audits the guest token access", async () => {
    const { root, content } = await fixture();
    const row = record(content);
    const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      if (sql.startsWith("select")) return { rows: [row] };
      expect(sql).toContain("insert into audit_events");
      expect(params?.[5]).toBe("guest_token");
      return { rows: [] };
    });
    const response = await handleGuestManufacturingDownload(validToken, {
      executor: { query },
      environment: { ARTIFACT_STORAGE_ROOT: root, ARTIFACT_STORAGE_DRIVER: "local" },
    });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-boardreadyops-artifact-sha256")).toBe(row.sha256);
    expect(query).toHaveBeenCalledTimes(2);
    const firstQuery = query.mock.calls[0];
    if (!firstQuery) throw new Error("Expected token lookup query");
    const [sql, parameters] = firstQuery;
    expect(parameters).toEqual([createHash("sha256").update(validToken).digest("hex")]);
    expect(sql).toContain("delivery.expires_at > now()");
    expect(sql).toContain("run.decision = 'pass'");
    expect(sql).toContain("a.role = 'manufacturing'");
    expect(sql).toContain("a.run_id = run.id");
    expect(sql).toContain("run.repository_id = repository.id");
    expect(sql).toContain("revision.bundle_sha256 = a.sha256");
    expect(sql).toContain("revision.commit_sha = run.commit_sha");
    expect(sql).toContain("manufacturing_share_authorizations");
    expect(sql).toContain("share.revoked_at is null");
  });

  it("rejects expired, revoked and unbound tokens without reading any file", async () => {
    const { root } = await fixture();
    const query = vi.fn(async () => ({ rows: [] }));
    const response = await handleGuestManufacturingDownload(validToken, {
      executor: { query },
      environment: { ARTIFACT_STORAGE_ROOT: root },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query).toHaveBeenCalledTimes(1);
    expect((await response.json()).error).toMatch(/no longer eligible/);
  });

  it("rejects malformed tokens before SQL and never reads external sender URLs", async () => {
    const query = vi.fn();
    expect(await lookupGuestManufacturingArtifact("../guest", { query })).toBeNull();
    const response = await handleGuestManufacturingDownload("not-a-token", {
      executor: { query },
      environment: {},
    });
    expect(response.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects any persisted draft role even when the database mock returns it", async () => {
    const { root, content } = await fixture();
    const query = vi.fn(async () => ({
      rows: [{ ...record(content), role: "draft-manufacturing" }],
    }));
    const response = await handleGuestManufacturingDownload(validToken, {
      executor: { query },
      environment: { ARTIFACT_STORAGE_ROOT: root },
    });
    expect(response.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("denies a same-size tampered ZIP before recording a guest download", async () => {
    const expected = Buffer.from("PK-real-fixture-manufacturing-archive");
    const actual = Buffer.from("PK-real-fixture-manufacturing-archivE");
    expect(actual.byteLength).toBe(expected.byteLength);
    const { root } = await fixture(actual);
    const query = vi.fn(async () => ({ rows: [record(expected)] }));
    const response = await handleGuestManufacturingDownload(validToken, {
      executor: { query },
      environment: { ARTIFACT_STORAGE_ROOT: root },
    });
    expect(response.status).toBe(409);
    expect(query).toHaveBeenCalledTimes(1);
    expect((await response.json()).error).toMatch(/digest/);
  });

  it("fails closed when the download audit write is unavailable", async () => {
    const { root, content } = await fixture();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("select")) return { rows: [record(content)] };
      throw new Error("audit database failure");
    });
    const response = await handleGuestManufacturingDownload(validToken, {
      executor: { query },
      environment: { ARTIFACT_STORAGE_ROOT: root },
    });
    expect(response.status).toBe(503);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fails closed if storage is absent without disclosing the artifact", async () => {
    const { root, content } = await fixture();
    const query = vi.fn(async () => ({ rows: [record(content)] }));
    const response = await handleGuestManufacturingDownload(validToken, {
      executor: { query },
      environment: { ARTIFACT_STORAGE_ROOT: path.join(root, "unavailable") },
    });
    expect(response.status).toBe(503);
    expect(query).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(root, "run_fixture", "archive.bin"))).toEqual(content);
  });
});
