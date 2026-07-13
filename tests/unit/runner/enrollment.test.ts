import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueRunnerEnrollment } from "../../../packages/db/src/runner-enrollment-admin.js";

const roots: string[] = [];
const installationId = "11111111-1111-4111-8111-111111111111";
const registrationId = "22222222-2222-4222-8222-222222222222";

async function privateFile(root: string, name: string, content: string): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, content, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(file, 0o600);
  return file;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("issueRunnerEnrollment", () => {
  it("writes the one-time token only to a new root-only file and returns non-secret metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-enrollment-"));
    roots.push(root);
    const databaseUrl = "postgresql://user:secret@db.example/boardreadyops";
    const databaseUrlFile = await privateFile(root, "database-url", `${databaseUrl}\n`);
    const tokenOutputFile = path.join(root, "handoff", "runner.token");
    const query = vi.fn(async (_url: string, sql: string, params: readonly unknown[]) => {
      expect(sql).toContain("boardreadyops_issue_runner_registration_enrollment");
      expect(params).toHaveLength(9);
      expect(params[1]).toBe(installationId);
      expect(params[4]).toBe("factory-runner-01");
      expect(params[5]).toBe("repository");
      expect(params[6]).toEqual(["octo-org/private-board"]);
      expect(params[7]).toMatch(/^[0-9a-f]{64}$/u);
      return {
        rows: [
          {
            outcome: "accepted",
            registration_id: registrationId,
            effective_expires_at: "2026-07-14T02:15:00.000Z",
          },
        ],
      };
    });

    const result = await issueRunnerEnrollment(
      {
        databaseUrlFile,
        installationId,
        name: "factory-runner-01",
        scope: "repository",
        allowedRepositories: ["octo-org/private-board"],
        tokenOutputFile,
        ttlSeconds: 900,
      },
      {
        query,
        token: () => "e".repeat(43),
      },
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toBe(databaseUrl);
    expect(result).toEqual({
      registrationId,
      expiresAt: "2026-07-14T02:15:00.000Z",
      tokenOutputFile,
    });
    expect(JSON.stringify(result)).not.toContain("e".repeat(43));
    await expect(readFile(tokenOutputFile, "utf8")).resolves.toBe(`${"e".repeat(43)}\n`);
    if (process.platform !== "win32") {
      expect((await stat(tokenOutputFile)).mode & 0o077).toBe(0);
    }
  });

  it("refuses an existing output file before querying the database", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-enrollment-"));
    roots.push(root);
    const databaseUrlFile = await privateFile(
      root,
      "database-url",
      "postgresql://user:secret@db.example/boardreadyops",
    );
    const tokenOutputFile = await privateFile(root, "runner.token", "occupied");
    const query = vi.fn();

    await expect(
      issueRunnerEnrollment(
        {
          databaseUrlFile,
          installationId,
          name: "factory-runner-01",
          scope: "installation",
          allowedRepositories: [],
          tokenOutputFile,
        },
        { query },
      ),
    ).rejects.toThrow(/refusing to overwrite/u);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects database URL files with broad permissions", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-enrollment-"));
    roots.push(root);
    const databaseUrlFile = path.join(root, "database-url");
    await writeFile(databaseUrlFile, "postgresql://user:secret@db.example/boardreadyops", { mode: 0o644 });
    await chmod(databaseUrlFile, 0o644);
    const query = vi.fn();

    await expect(
      issueRunnerEnrollment(
        {
          databaseUrlFile,
          installationId,
          name: "factory-runner-01",
          scope: "installation",
          allowedRepositories: [],
          tokenOutputFile: path.join(root, "runner.token"),
        },
        { query },
      ),
    ).rejects.toThrow(/must not be readable or writable/u);
    expect(query).not.toHaveBeenCalled();
  });

  it("removes the staged token when psql fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-enrollment-"));
    roots.push(root);
    const databaseUrlFile = await privateFile(
      root,
      "database-url",
      "postgresql://user:secret@db.example/boardreadyops",
    );
    const tokenOutputFile = path.join(root, "runner.token");

    await expect(
      issueRunnerEnrollment(
        {
          databaseUrlFile,
          installationId,
          name: "factory-runner-01",
          scope: "installation",
          allowedRepositories: [],
          tokenOutputFile,
        },
        {
          query: vi.fn(async () => {
            throw new Error("psql failed");
          }),
          token: () => "e".repeat(43),
        },
      ),
    ).rejects.toThrow(/psql failed/u);
    await expect(readFile(tokenOutputFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the staged token when issuance conflicts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-enrollment-"));
    roots.push(root);
    const databaseUrlFile = await privateFile(
      root,
      "database-url",
      "postgresql://user:secret@db.example/boardreadyops",
    );
    const tokenOutputFile = path.join(root, "runner.token");

    await expect(
      issueRunnerEnrollment(
        {
          databaseUrlFile,
          installationId,
          name: "factory-runner-01",
          scope: "installation",
          allowedRepositories: [],
          tokenOutputFile,
        },
        {
          query: vi.fn(async () => ({
            rows: [
              {
                outcome: "conflict",
                registration_id: registrationId,
                effective_expires_at: null,
              },
            ],
          })),
          token: () => "e".repeat(43),
        },
      ),
    ).rejects.toThrow(/already uses this name or scope/u);
    await expect(readFile(tokenOutputFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
