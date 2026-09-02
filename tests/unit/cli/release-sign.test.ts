import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseSignCommand, releaseVerifyCommand } from "../../../src/cli/commands/release.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: {
        write(chunk: string): boolean {
          stdout += chunk;
          return true;
        },
      } as unknown as NodeJS.WritableStream,
      stderr: {
        write(chunk: string): boolean {
          stderr += chunk;
          return true;
        },
      } as unknown as NodeJS.WritableStream,
    },
    output: () => ({ stdout, stderr }),
  };
}

async function makeBundle(): Promise<{ bundle: string; keyPath: string; pubPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brops-cli-sign-"));
  tempDirs.push(dir);
  const bundle = path.join(dir, "bundle");
  await fs.mkdir(bundle, { recursive: true });
  await fs.writeFile(path.join(bundle, "manifest.json"), '{"schemaVersion":2,"artifacts":[]}\n');
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyPath = path.join(dir, "key.pem");
  const pubPath = path.join(dir, "key.pub.pem");
  await fs.writeFile(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  await fs.writeFile(pubPath, publicKey.export({ type: "spki", format: "pem" }).toString());
  return { bundle, keyPath, pubPath };
}

describe("release sign / verify commands", () => {
  it("signs a bundle and verifies the signature with the public key", async () => {
    const { bundle, keyPath, pubPath } = await makeBundle();

    const sign = streams();
    expect(await releaseSignCommand(bundle, { key: keyPath }, sign.streams)).toBe(0);
    expect(await fs.stat(path.join(bundle, "manifest.sig"))).toBeTruthy();

    const verify = streams();
    expect(await releaseVerifyCommand(bundle, { publicKey: pubPath }, verify.streams)).toBe(0);
    expect(verify.output().stdout).toContain("signature");
  });

  it("returns 2 when no key is provided", async () => {
    const { bundle } = await makeBundle();
    const io = streams();
    expect(await releaseSignCommand(bundle, {}, io.streams)).toBe(2);
    expect(io.output().stderr).toContain("private key is required");
  });

  it("fails verification when a public key is required but the bundle is unsigned", async () => {
    const { bundle, pubPath } = await makeBundle();
    const io = streams();
    expect(await releaseVerifyCommand(bundle, { publicKey: pubPath }, io.streams)).toBe(1);
    expect(io.output().stderr).toContain("manifest.sig");
  });

  it("fails verification when the manifest is tampered after signing", async () => {
    const { bundle, keyPath, pubPath } = await makeBundle();
    await releaseSignCommand(bundle, { key: keyPath }, streams().streams);
    await fs.writeFile(path.join(bundle, "manifest.json"), '{"schemaVersion":2,"artifacts":[],"tampered":true}\n');

    const io = streams();
    expect(await releaseVerifyCommand(bundle, { publicKey: pubPath }, io.streams)).toBe(1);
  });

  it("prints a release certificate after a successful verification", async () => {
    const { bundle, keyPath, pubPath } = await makeBundle();
    await releaseSignCommand(bundle, { key: keyPath }, streams().streams);

    const verify = streams();
    expect(await releaseVerifyCommand(bundle, { publicKey: pubPath }, verify.streams)).toBe(0);
    const stdout = verify.output().stdout;
    expect(stdout).toContain("Release Certificate");
    expect(stdout).toContain("Signature:     valid Ed25519");
  });

  it("verifies against an active trust store entry", async () => {
    const { bundle, keyPath, pubPath } = await makeBundle();
    await releaseSignCommand(bundle, { key: keyPath }, streams().streams);

    const dir = path.dirname(bundle);
    const trustStorePath = path.join(dir, "trust-store.json");
    await fs.writeFile(
      trustStorePath,
      JSON.stringify([
        { keyId: "key-2026", publicKey: await fs.readFile(pubPath, "utf8"), validFrom: "2020-01-01T00:00:00.000Z" },
      ]),
    );

    const io = streams();
    expect(await releaseVerifyCommand(bundle, { trustStore: trustStorePath, format: "json" }, io.streams)).toBe(0);
    expect(JSON.parse(io.output().stdout).signature.matchedKeyId).toBe("key-2026");
  });

  it("fails verification when the matching trust store key is revoked", async () => {
    const { bundle, keyPath, pubPath } = await makeBundle();
    await releaseSignCommand(bundle, { key: keyPath }, streams().streams);

    const dir = path.dirname(bundle);
    const trustStorePath = path.join(dir, "trust-store.json");
    await fs.writeFile(
      trustStorePath,
      JSON.stringify([
        {
          keyId: "key-2026",
          publicKey: await fs.readFile(pubPath, "utf8"),
          validFrom: "2020-01-01T00:00:00.000Z",
          revokedAt: "2020-06-01T00:00:00.000Z",
        },
      ]),
    );

    const io = streams();
    expect(await releaseVerifyCommand(bundle, { trustStore: trustStorePath }, io.streams)).toBe(1);
  });

  it("rejects passing both --public-key and --trust-store", async () => {
    const { bundle, pubPath } = await makeBundle();
    const io = streams();
    expect(await releaseVerifyCommand(bundle, { publicKey: pubPath, trustStore: pubPath }, io.streams)).toBe(2);
    expect(io.output().stderr).toContain("either --public-key or --trust-store");
  });
});
