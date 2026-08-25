import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createComponentIntelligenceResolver,
  nexarProviderName,
} from "../../../apps/web/lib/component-intelligence-resolver.js";
import { createCredentialCipher } from "../../../packages/cloud-core/src/credential-encryption.js";
import type {
  InstallationCredentialStore,
  StoredCredential,
} from "../../../packages/db/src/installation-credential-store.js";

const key = randomBytes(32).toString("base64");
const cipher = createCredentialCipher(key);
const now = new Date("2026-08-25T12:00:00.000Z");

function credentialStore(stored: StoredCredential | undefined): InstallationCredentialStore {
  return {
    find: vi.fn(async () => stored),
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => true),
    markRejected: vi.fn(async () => {}),
    clearRejection: vi.fn(async () => {}),
  };
}

function stored(envelope: string, rejectedAt?: string): StoredCredential {
  return {
    installationId: "installation-1",
    provider: nexarProviderName,
    envelope,
    rejectedAt,
    rejectedReason: rejectedAt ? "provider returned 401" : undefined,
  };
}

const validEnvelope = cipher.encrypt(JSON.stringify({ clientId: "id", clientSecret: "secret" }));

describe("component intelligence resolver", () => {
  it("resolves a real provider for an installation that supplied credentials", async () => {
    const resolve = createComponentIntelligenceResolver({
      credentials: credentialStore(stored(validEnvelope)),
      cipher,
      now: () => now,
    });

    const provider = await resolve("installation-1");

    expect(provider.name).toBe("nexar");
    // The licence limits travel with the provider, so the watch cannot cache across tenants.
    expect(provider.cachePolicy.shareableAcrossTenants).toBe(false);
  });

  it("falls back to the null provider when no key is configured", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    const resolve = createComponentIntelligenceResolver({ credentials, cipher: undefined, now: () => now });

    expect((await resolve("installation-1")).name).toBe("none");
    // Without a key there is nothing to read, so the credential is never even fetched.
    expect(credentials.find).not.toHaveBeenCalled();
  });

  it("falls back to the null provider when the installation supplied nothing", async () => {
    const resolve = createComponentIntelligenceResolver({
      credentials: credentialStore(undefined),
      cipher,
      now: () => now,
    });

    expect((await resolve("installation-1")).name).toBe("none");
  });

  it("degrades rather than throwing when the envelope cannot be decrypted", async () => {
    // A key rotated without listing the retired one. Throwing would fail the whole pass and
    // take every other installation's boards down with it.
    const foreign = createCredentialCipher(randomBytes(32).toString("base64"));
    const diagnostics: string[] = [];
    const resolve = createComponentIntelligenceResolver({
      credentials: credentialStore(stored(foreign.encrypt(JSON.stringify({ clientId: "a", clientSecret: "b" })))),
      cipher,
      now: () => now,
      onDiagnostic: (event) => diagnostics.push(event),
    });

    expect((await resolve("installation-1")).name).toBe("none");
    expect(diagnostics).toContain("component_intelligence.credential_undecryptable");
  });

  it("degrades on a malformed or incomplete credential payload", async () => {
    for (const payload of ["not json", JSON.stringify({ clientId: "id" }), JSON.stringify({ clientSecret: "s" })]) {
      const diagnostics: string[] = [];
      const resolve = createComponentIntelligenceResolver({
        credentials: credentialStore(stored(cipher.encrypt(payload))),
        cipher,
        now: () => now,
        onDiagnostic: (event) => diagnostics.push(event),
      });

      expect((await resolve("installation-1")).name).toBe("none");
      expect(diagnostics).toContain("component_intelligence.credential_malformed");
    }
  });

  it("reuses a constructed provider across boards in the same pass", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    const resolve = createComponentIntelligenceResolver({ credentials, cipher, now: () => now });

    await resolve("installation-1");
    await resolve("installation-1");

    // Re-reading and re-authenticating per board would cost a token request each time.
    expect(credentials.find).toHaveBeenCalledTimes(1);
  });

  it("re-reads the credential once the cache window passes", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    let clock = now.getTime();
    const resolve = createComponentIntelligenceResolver({ credentials, cipher, now: () => new Date(clock) });

    await resolve("installation-1");
    clock += 6 * 60 * 1000;
    await resolve("installation-1");

    // A customer who fixes a revoked key should not wait for a deploy.
    expect(credentials.find).toHaveBeenCalledTimes(2);
  });

  it("keeps one installation's provider separate from another's", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    const resolve = createComponentIntelligenceResolver({ credentials, cipher, now: () => now });

    await resolve("installation-1");
    await resolve("installation-2");

    expect(credentials.find).toHaveBeenCalledTimes(2);
    expect(vi.mocked(credentials.find).mock.calls.map(([id]) => id)).toEqual(["installation-1", "installation-2"]);
  });

  it("records a rejection when the provider refuses the credential", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    const resolve = createComponentIntelligenceResolver({
      credentials,
      cipher,
      now: () => now,
      // A token endpoint that refuses the client is the credential case, not an outage.
      fetch: (async () =>
        new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })) as typeof globalThis.fetch,
    });

    const provider = await resolve("installation-1");
    await expect(provider.lookup([{ mpn: "A" }])).rejects.toThrow();

    expect(credentials.markRejected).toHaveBeenCalledWith(
      "installation-1",
      nexarProviderName,
      expect.stringContaining("401"),
      now,
    );
  });

  it("does not record a rejection for a transient provider failure", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    const resolve = createComponentIntelligenceResolver({
      credentials,
      cipher,
      now: () => now,
      fetch: (async (url: string | URL | Request) =>
        new URL(String(url)).hostname === "identity.nexar.com"
          ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
          : new Response("upstream down", { status: 502 })) as typeof globalThis.fetch,
    });

    const provider = await resolve("installation-1");
    await expect(provider.lookup([{ mpn: "A" }])).rejects.toThrow();

    // Marking an outage as a revoked key would make customers re-enter a working secret.
    expect(credentials.markRejected).not.toHaveBeenCalled();
  });

  it("clears a recorded rejection once a lookup succeeds", async () => {
    const credentials = credentialStore(stored(validEnvelope, "2026-08-24T00:00:00.000Z"));
    const resolve = createComponentIntelligenceResolver({
      credentials,
      cipher,
      now: () => now,
      fetch: (async (url: string | URL | Request) =>
        new URL(String(url)).hostname === "identity.nexar.com"
          ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
          : new Response(JSON.stringify({ data: { supMultiMatch: [] } }), { status: 200 })) as typeof globalThis.fetch,
    });

    const provider = await resolve("installation-1");
    await provider.lookup([{ mpn: "A" }]);

    expect(credentials.clearRejection).toHaveBeenCalledWith("installation-1", nexarProviderName);
  });

  it("does not write on every pass for a healthy installation", async () => {
    const credentials = credentialStore(stored(validEnvelope));
    const resolve = createComponentIntelligenceResolver({
      credentials,
      cipher,
      now: () => now,
      fetch: (async (url: string | URL | Request) =>
        new URL(String(url)).hostname === "identity.nexar.com"
          ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
          : new Response(JSON.stringify({ data: { supMultiMatch: [] } }), { status: 200 })) as typeof globalThis.fetch,
    });

    const provider = await resolve("installation-1");
    await provider.lookup([{ mpn: "A" }]);

    // Nothing changed, so nothing is written.
    expect(credentials.clearRejection).not.toHaveBeenCalled();
    expect(credentials.markRejected).not.toHaveBeenCalled();
  });
});
