import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateRunnerIdentity, loadRunnerIdentity } from "../../../src/runner/identity.js";

const runnerId = "11111111-1111-4111-8111-111111111111";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function privateFile(root: string, name: string, content: string): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, content, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(file, 0o600);
  return file;
}

describe("runner identity onboarding", () => {
  it("activates with a one-time token and persists only public configuration plus root-only key files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-identity-"));
    roots.push(root);
    const enrollmentToken = "e".repeat(43);
    const tokenFile = await privateFile(root, "enrollment-token", `${enrollmentToken}\n`);
    const identityDirectory = path.join(root, "identity");
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.enrollmentToken).toBe(enrollmentToken);
      expect(body.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/u);
      expect(body.capabilities).toEqual(["kicad:10", "linux-x64"]);
      return Response.json({ protocolVersion: 1, status: "activated", registrationId: runnerId });
    });

    const activated = await activateRunnerIdentity({
      controlPlaneUrl: "https://control.example",
      enrollmentTokenFile: tokenFile,
      identityDirectory,
      capabilities: ["linux-x64", "kicad:10", "linux-x64"],
      labels: ["customer-a"],
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-07-14T02:00:00.000Z"),
    });

    expect(activated.runnerId).toBe(runnerId);
    const identityText = await readFile(activated.identityFile, "utf8");
    expect(identityText).not.toContain(enrollmentToken);
    expect(identityText).not.toContain("PRIVATE KEY");
    const identity = JSON.parse(identityText) as Record<string, unknown>;
    expect(identity).toMatchObject({
      version: 1,
      controlPlaneUrl: "https://control.example",
      runnerId,
      workerClass: "self_hosted",
      privateKeyFile: "runner-private-key.pem",
      publicKeyFile: "runner-public-key.pem",
      capabilities: ["kicad:10", "linux-x64"],
      labels: ["customer-a"],
      activatedAt: "2026-07-14T02:00:00.000Z",
    });
    await expect(readFile(activated.privateKeyFile, "utf8")).resolves.toMatch(/BEGIN PRIVATE KEY/u);
    await expect(readFile(activated.publicKeyFile, "utf8")).resolves.toMatch(/BEGIN PUBLIC KEY/u);
    const loaded = await loadRunnerIdentity(activated.identityFile);
    expect(loaded.runnerId).toBe(runnerId);
    expect(loaded.privateKeyPath).toBe(activated.privateKeyFile);
    if (process.platform !== "win32") {
      expect((await stat(activated.identityFile)).mode & 0o077).toBe(0);
      expect((await stat(activated.privateKeyFile)).mode & 0o077).toBe(0);
      expect((await stat(activated.publicKeyFile)).mode & 0o077).toBe(0);
    }
  });

  it("rejects enrollment token files readable by other users", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-identity-"));
    roots.push(root);
    const tokenFile = path.join(root, "enrollment-token");
    await writeFile(tokenFile, "e".repeat(43), { mode: 0o644 });
    await chmod(tokenFile, 0o644);

    await expect(
      activateRunnerIdentity({
        controlPlaneUrl: "https://control.example",
        enrollmentTokenFile: tokenFile,
        identityDirectory: path.join(root, "identity"),
        fetch: vi.fn() as typeof fetch,
      }),
    ).rejects.toThrow(/must not be readable or writable by group or other users/u);
  });

  it("refuses to overwrite an existing identity before contacting the control plane", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-identity-"));
    roots.push(root);
    const tokenFile = await privateFile(root, "enrollment-token", "e".repeat(43));
    const identityDirectory = path.join(root, "identity");
    await writeFile(identityDirectory, "occupied", "utf8");
    const fetchMock = vi.fn();

    await expect(
      activateRunnerIdentity({
        controlPlaneUrl: "https://control.example",
        enrollmentTokenFile: tokenFile,
        identityDirectory,
        fetch: fetchMock as typeof fetch,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects identity directories accessible by other users", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-identity-"));
    roots.push(root);
    const identityDirectory = path.join(root, "identity");
    await mkdir(identityDirectory, { mode: 0o755 });
    await chmod(identityDirectory, 0o755);
    const identityFile = path.join(identityDirectory, "runner.json");
    await writeFile(identityFile, "{}", { mode: 0o600 });

    await expect(loadRunnerIdentity(identityFile)).rejects.toThrow(/must not be accessible by group or other users/u);
  });

  it("rejects symlinked identity files", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-identity-"));
    roots.push(root);
    const identityDirectory = path.join(root, "identity");
    await mkdir(identityDirectory, { mode: 0o700 });
    const target = await privateFile(root, "outside.json", "{}");
    const identityFile = path.join(identityDirectory, "runner.json");
    await symlink(target, identityFile);

    await expect(loadRunnerIdentity(identityFile)).rejects.toThrow(/not a regular file/u);
  });

  it("rejects identity key paths that escape the identity directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-identity-"));
    roots.push(root);
    const identityFile = await privateFile(
      root,
      "runner.json",
      JSON.stringify({
        version: 1,
        controlPlaneUrl: "https://control.example",
        runnerId,
        workerClass: "self_hosted",
        privateKeyFile: "../outside.pem",
        publicKeyFile: "runner-public-key.pem",
        capabilities: [],
        labels: [],
        activatedAt: "2026-07-14T02:00:00.000Z",
      }),
    );

    await expect(loadRunnerIdentity(identityFile)).rejects.toThrow(/must be a relative file/u);
  });
});
