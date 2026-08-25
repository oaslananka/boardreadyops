import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleComponentCredentialSubmission } from "../../../apps/web/lib/component-credential-routes.js";
import { issueSettingsFormToken } from "../../../apps/web/lib/settings-form-token.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";
import { createCredentialCipher } from "../../../packages/cloud-core/src/credential-encryption.js";
import type { InstallationCredentialStore } from "../../../packages/db/src/installation-credential-store.js";

const sessionSecret = randomBytes(32).toString("base64");
const encryptionKey = randomBytes(32).toString("base64");
const cipher = createCredentialCipher(encryptionKey);
const now = new Date("2026-08-25T12:00:00.000Z");
const installationId = "installation-1";
const clientSecretValue = "super-secret-nexar-value";

const environment = {
  SESSION_SECRET: sessionSecret,
  BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  DATABASE_URL: "postgresql://example/db",
};

const session: UserSession = {
  userId: 4242,
  login: "octocat",
  installationIds: [111],
  issuedAt: "2026-08-25T08:00:00.000Z",
  expiresAt: "2026-08-25T16:00:00.000Z",
};

function store() {
  return {
    find: vi.fn(async () => undefined),
    put: vi.fn(async (_installationId: string, _provider: string, _envelope: string) => {}),
    remove: vi.fn(async (_installationId: string, _provider: string) => true),
    markRejected: vi.fn(async () => {}),
    clearRejection: vi.fn(async () => {}),
  } satisfies InstallationCredentialStore;
}

function dependencies(
  credentialStore: InstallationCredentialStore,
  options: { session?: UserSession | undefined; allowed?: boolean } = {},
) {
  const close = vi.fn(async () => {});
  const authorizeInstallation = vi.fn(async () => options.allowed ?? true);
  return {
    close,
    authorizeInstallation,
    deps: {
      authorize: async () => ({
        session: "session" in options ? options.session : session,
        authorizeRepository: async () => options.allowed ?? true,
        authorizeInstallation,
      }),
      credentialStore: async () => ({ store: credentialStore, close }),
    },
  };
}

function form(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request("https://boardreadyops.com/api/v1/settings/component-intelligence", {
    method: "POST",
    body,
  });
}

function validToken(id = installationId): string {
  return issueSettingsFormToken(session, id, sessionSecret, now);
}

function outcome(response: Response): string {
  return new URL(response.headers.get("location") ?? "", "https://boardreadyops.com").searchParams.get("status") ?? "";
}

describe("component credential submission", () => {
  it("stores the credential encrypted, never in plaintext", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "client-id",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("saved");
    const [, provider, envelope] = vi.mocked(credentials.put).mock.calls[0] ?? [];
    expect(provider).toBe("nexar");
    // The whole point: what reaches the store is an envelope, not the secret.
    expect(envelope).not.toContain(clientSecretValue);
    expect(JSON.parse(cipher.decrypt(String(envelope)) ?? "{}")).toEqual({
      clientId: "client-id",
      clientSecret: clientSecretValue,
    });
  });

  it("never puts the credential in the response", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "client-id",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    const rendered = `${response.headers.get("location")} ${await response.text()}`;
    expect(rendered).not.toContain(clientSecretValue);
    expect(rendered).not.toContain("client-id");
  });

  it("carries the optional scope through when supplied", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "client-id",
        client_secret: clientSecretValue,
        scope: "supply.domain",
      }),
      environment,
      now,
      deps,
    );

    const envelope = String(vi.mocked(credentials.put).mock.calls[0]?.[2]);
    expect(JSON.parse(cipher.decrypt(envelope) ?? "{}").scope).toBe("supply.domain");
  });

  it("refuses a request with no valid session", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials, { session: undefined });

    const response = await handleComponentCredentialSubmission(
      form({ installation_id: installationId, action: "save", form_token: validToken() }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("signed_out");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("refuses a submission with no CSRF token", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        client_id: "a",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("expired");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("refuses a token minted for a different installation", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken("another-installation"),
        client_id: "a",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("expired");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("checks the CSRF token before touching the database", async () => {
    const credentials = store();
    const { deps, close, authorizeInstallation } = dependencies(credentials);

    await handleComponentCredentialSubmission(
      form({ installation_id: installationId, action: "save", form_token: "forged" }),
      environment,
      now,
      deps,
    );

    // A forged token must not cost an authorization lookup or a connection.
    expect(authorizeInstallation).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("refuses an installation the viewer cannot administer", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials, { allowed: false });

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "a",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    // A valid token proves the form came from us, not that this viewer may act here.
    expect(outcome(response)).toBe("forbidden");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("rejects an incomplete credential without writing", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({ installation_id: installationId, action: "save", form_token: validToken(), client_id: "only-id" }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("incomplete");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("removes a credential when asked", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({ installation_id: installationId, action: "remove", form_token: validToken() }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("removed");
    expect(credentials.remove).toHaveBeenCalledWith(installationId, "nexar");
  });

  it("refuses an unknown action", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({ installation_id: installationId, action: "escalate", form_token: validToken() }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("invalid");
    expect(credentials.put).not.toHaveBeenCalled();
    expect(credentials.remove).not.toHaveBeenCalled();
  });

  it("refuses oversized fields rather than storing them", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "a",
        client_secret: "x".repeat(600),
      }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("invalid");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("does not accept a credential when no encryption key is configured", async () => {
    const credentials = store();
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "a",
        client_secret: clientSecretValue,
      }),
      { SESSION_SECRET: sessionSecret, DATABASE_URL: environment.DATABASE_URL },
      now,
      deps,
    );

    // Accepting it would mean storing it in the clear or dropping it silently.
    expect(outcome(response)).toBe("unavailable");
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("closes the connection even when the store throws", async () => {
    const credentials = store();
    credentials.put = vi.fn(async () => {
      throw new Error("database is down");
    });
    const { deps, close } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "a",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    expect(outcome(response)).toBe("failed");
    expect(close).toHaveBeenCalled();
  });

  it("does not describe the failure it hit", async () => {
    const credentials = store();
    credentials.put = vi.fn(async () => {
      throw new Error("connection to 10.0.0.5 refused for user boardreadyops");
    });
    const { deps } = dependencies(credentials);

    const response = await handleComponentCredentialSubmission(
      form({
        installation_id: installationId,
        action: "save",
        form_token: validToken(),
        client_id: "a",
        client_secret: clientSecretValue,
      }),
      environment,
      now,
      deps,
    );

    const rendered = `${response.headers.get("location")} ${await response.text()}`;
    expect(rendered).not.toContain("10.0.0.5");
    expect(rendered).not.toContain("boardreadyops");
  });
});
