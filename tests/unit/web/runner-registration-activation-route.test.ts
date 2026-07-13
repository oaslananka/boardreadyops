import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleRunnerRegistrationActivationRequest,
  type RunnerRegistrationActivationRouteDependencies,
} from "../../../apps/web/lib/runner-registration-activation-route.js";

const enrollmentToken = "e".repeat(43);
const registrationId = "44444444-4444-4444-8444-444444444444";
const installationId = "55555555-5555-4555-8555-555555555555";
const publicKey = `-----BEGIN PUBLIC KEY-----\n${"A".repeat(44)}\n-----END PUBLIC KEY-----`;

const query = vi.fn();
const issueEnrollment = vi.fn();
const activateRegistration = vi.fn();
const queryExecutor = vi.fn(() => ({ query }));

const dependencies: RunnerRegistrationActivationRouteDependencies = {
  queryExecutor,
  createEnrollmentStore: () => ({ issueEnrollment, activateRegistration }),
};

function activationBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    enrollmentToken,
    algorithm: "ed25519",
    publicKey,
    capabilities: ["kicad:10", "docker"],
    ...overrides,
  };
}

function activationRequest(input: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request("https://boardreadyops.test/api/v1/runner/registrations/activate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...input.headers,
    },
    body: input.body ?? JSON.stringify(activationBody()),
  });
}

beforeEach(() => {
  query.mockReset();
  issueEnrollment.mockReset();
  activateRegistration.mockReset();
  queryExecutor.mockClear();
  activateRegistration.mockResolvedValue({
    status: "accepted",
    registrationId,
    installationId,
  });
});

describe("self-hosted runner registration activation route", () => {
  it("activates with the one-time token and returns only the assigned runner identity", async () => {
    const response = await handleRunnerRegistrationActivationRequest(activationRequest(), dependencies);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(activateRegistration).toHaveBeenCalledWith({
      enrollmentToken,
      publicKey,
      capabilities: ["kicad:10", "docker"],
    });
    const payload = await response.json();
    expect(payload).toEqual({
      protocolVersion: 1,
      status: "activated",
      registrationId,
    });
    expect(JSON.stringify(payload)).not.toContain(enrollmentToken);
    expect(JSON.stringify(payload)).not.toContain(installationId);
  });

  it("returns a safe success response for an exact activation replay", async () => {
    activateRegistration.mockResolvedValue({ status: "replayed", registrationId, installationId });

    const response = await handleRunnerRegistrationActivationRequest(activationRequest(), dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      protocolVersion: 1,
      status: "replayed",
      registrationId,
    });
  });

  it("uses a generic unauthorized response for expired, revoked, or unknown enrollment secrets", async () => {
    activateRegistration.mockResolvedValue({ status: "stale", registrationId, installationId });

    const response = await handleRunnerRegistrationActivationRequest(activationRequest(), dependencies);

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload).toEqual({ ok: false, error: "runner enrollment is invalid or expired" });
    expect(JSON.stringify(payload)).not.toContain(enrollmentToken);
    expect(JSON.stringify(payload)).not.toContain(registrationId);
    expect(JSON.stringify(payload)).not.toContain(installationId);
  });

  it("rejects altered-key or already-bound registration conflicts without identity disclosure", async () => {
    activateRegistration.mockResolvedValue({ status: "conflict", registrationId, installationId });

    const response = await handleRunnerRegistrationActivationRequest(activationRequest(), dependencies);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "runner enrollment conflicts with an existing registration",
    });
  });

  it("rejects caller-selected tenant or registration identifiers before database access", async () => {
    const response = await handleRunnerRegistrationActivationRequest(
      activationRequest({
        body: JSON.stringify(
          activationBody({
            installationId,
            registrationId,
          }),
        ),
      }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(queryExecutor).not.toHaveBeenCalled();
    expect(activateRegistration).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and non-canonical declared content lengths", async () => {
    const malformed = await handleRunnerRegistrationActivationRequest(activationRequest({ body: "{" }), dependencies);
    expect(malformed.status).toBe(400);

    const nonCanonicalLength = await handleRunnerRegistrationActivationRequest(
      activationRequest({ body: "{}", headers: { "content-length": "02" } }),
      dependencies,
    );
    expect(nonCanonicalLength.status).toBe(400);
    expect(queryExecutor).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before schema validation or database access", async () => {
    const response = await handleRunnerRegistrationActivationRequest(
      activationRequest({
        body: JSON.stringify(activationBody({ publicKey: "A".repeat(33 * 1024) })),
      }),
      dependencies,
    );

    expect(response.status).toBe(413);
    expect(queryExecutor).not.toHaveBeenCalled();
    expect(activateRegistration).not.toHaveBeenCalled();
  });

  it("fails closed when the database is unconfigured or activation persistence fails", async () => {
    const unavailableDependencies: RunnerRegistrationActivationRouteDependencies = {
      ...dependencies,
      queryExecutor: () => undefined,
    };
    const unconfigured = await handleRunnerRegistrationActivationRequest(activationRequest(), unavailableDependencies);
    expect(unconfigured.status).toBe(503);

    activateRegistration.mockRejectedValue(new Error(`database failure for ${enrollmentToken}`));
    const failed = await handleRunnerRegistrationActivationRequest(activationRequest(), dependencies);
    expect(failed.status).toBe(503);
    const payload = await failed.json();
    expect(payload).toEqual({ ok: false, error: "runner activation is temporarily unavailable" });
    expect(JSON.stringify(payload)).not.toContain(enrollmentToken);
  });
});
