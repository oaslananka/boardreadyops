import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inspectRemoteMcpReleasePrerequisites } from "../../../packages/db/scripts/remote-mcp-release-preflight.mjs";

const root = resolve(process.cwd(), "packages/db/scripts/remote-mcp-release-preflight.mjs");
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicJwk = rsa.publicKey.export({ format: "jwk" });
const fullEnvironment = {
  BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED: "true",
  BOARDREADYOPS_REMOTE_MCP_HANDLER_READY: "true",
  BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: "https://boardreadyops.com",
  BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: privateKey.replaceAll("\n", "\\n"),
  BOARDREADYOPS_REMOTE_MCP_KEY_ID: "rotatable-2026-key",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: privateKey,
  SESSION_SECRET: "opaque-private-session-value-".repeat(3),
  DATABASE_URL: "postgresql://fixture_username:fixture_password@localhost/not-used",
};
const presence = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`p${index}`, true]));
const clientRows = [
  {
    client_id: "https://chatgpt.com/oauth/client.json",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    display_name: "ChatGPT registered client",
    enabled: true,
  },
];
const get = (checks: { id: string; status: string }[], id: string) => checks.find((check) => check.id === id)?.status;

describe("MCP operator preflight is always an evidence-only release blocker", () => {
  it("never grants production release even with all technical prerequisites", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [presence] })
      .mockResolvedValueOnce({ rows: clientRows });
    const report = await inspectRemoteMcpReleasePrerequisites(fullEnvironment, query);
    expect(report.publicMcpReleaseApproved).toBe(false);
    expect(report.schemaVersion).toBe(1);
    expect(report.checks.slice(0, 8).every((check: { status: string }) => check.status === "configured")).toBe(true);
    expect(get(report.checks, "live_installation_user_collaborator_permission")).toBe("manual_required");
    expect(get(report.checks, "live_chatgpt_oauth_mcp_exchange")).toBe("manual_required");
    expect(get(report.checks, "live_claude_oauth_mcp_exchange")).toBe("manual_required");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toMatch(/^select to_regclass/u);
    expect(query.mock.calls[1]?.[0]).toMatch(/^select client_id/u);
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "fixture_password",
      privateKey.slice(0, 40),
      "SESSION_SECRET",
      "chatgpt.com",
      "rotatable-2026-key",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("reports absent switches and optional read-only DB check without touching storage", async () => {
    const report = await inspectRemoteMcpReleasePrerequisites({});
    expect(report.publicMcpReleaseApproved).toBe(false);
    expect(get(report.checks, "oauth_release_switch")).toBe("blocked");
    expect(get(report.checks, "mcp_release_switch")).toBe("blocked");
    expect(get(report.checks, "oauth_database_schema")).toBe("not_checked");
    expect(get(report.checks, "enabled_exact_client_registrations")).toBe("not_checked");
  });

  it("handles missing migration and SQL failures without leaking database diagnostics", async () => {
    const missing = await inspectRemoteMcpReleasePrerequisites(
      fullEnvironment,
      vi.fn().mockResolvedValue({ rows: [{ ...presence, p7: false }] }),
    );
    expect(get(missing.checks, "oauth_database_schema")).toBe("blocked");
    expect(get(missing.checks, "enabled_exact_client_registrations")).toBe("blocked");
    const broken = await inspectRemoteMcpReleasePrerequisites(
      fullEnvironment,
      vi.fn().mockRejectedValue(new Error("postgresql://secret:db-password@private-host")),
    );
    expect(get(broken.checks, "oauth_database_schema")).toBe("blocked");
    expect(JSON.stringify(broken)).not.toContain("db-password");
    expect(JSON.stringify(broken)).not.toContain("private-host");
  });

  it.each([
    ["github-app-key", { ...fullEnvironment, GITHUB_APP_PRIVATE_KEY: "bad-key" }, "github_app_signing_configuration"],
    [
      "oauth-signing-key",
      { ...fullEnvironment, BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY: "bad-key" },
      "oauth_rsa_signing_and_rotation",
    ],
    ["issuer", { ...fullEnvironment, BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER: "https://not-our-site.example" }, "issuer"],
    ["session-secret", { ...fullEnvironment, SESSION_SECRET: "too-short" }, "browser_session_secret"],
    [
      "mcp-release-switch",
      { ...fullEnvironment, BOARDREADYOPS_REMOTE_MCP_HANDLER_READY: "false" },
      "mcp_release_switch",
    ],
    [
      "duplicate-rotation-kid",
      {
        ...fullEnvironment,
        BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS: JSON.stringify({
          keys: [
            {
              kty: "RSA",
              alg: "RS256",
              use: "sig",
              kid: "rotatable-2026-key",
              n: publicJwk.n,
              e: publicJwk.e,
            },
          ],
        }),
      },
      "oauth_rsa_signing_and_rotation",
    ],
  ] as const)("blocks invalid authentication prerequisite: %s", async (_label, environment, id) => {
    const result = await inspectRemoteMcpReleasePrerequisites(environment);
    expect(get(result.checks, id)).toBe("blocked");
  });

  it("accepts a validated retired public key without treating it as live-client acceptance", async () => {
    const configured = {
      ...fullEnvironment,
      BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS: JSON.stringify({
        keys: [
          {
            kty: "RSA",
            alg: "RS256",
            use: "sig",
            kid: "retired-public-key-2025",
            n: publicJwk.n,
            e: publicJwk.e,
          },
        ],
      }),
    };
    const result = await inspectRemoteMcpReleasePrerequisites(configured);
    expect(get(result.checks, "oauth_rsa_signing_and_rotation")).toBe("configured");
    expect(result.publicMcpReleaseApproved).toBe(false);
  });

  it.each([
    [{ ...clientRows[0], enabled: false }],
    [{ ...clientRows[0], redirect_uri: "http://insecure.example/callback" }],
    [{ ...clientRows[0], client_id: "invalid id containing spaces" }],
    Array.from({ length: 101 }, () => clientRows[0]),
  ])("rejects absent, malformed or oversized client registration views", async (clients) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [presence] })
      .mockResolvedValueOnce({ rows: clients });
    const result = await inspectRemoteMcpReleasePrerequisites(fullEnvironment, query);
    expect(get(result.checks, "enabled_exact_client_registrations")).toBe("blocked");
    expect(result.publicMcpReleaseApproved).toBe(false);
  });

  it("CLI returns a nonzero release hold with only fixed-format redacted JSON", () => {
    const result = spawnSync(process.execPath, [root], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        SESSION_SECRET: "local-private-marker-must-not-leak",
        DATABASE_URL: "postgresql://secret:pwd@internal",
      },
    });
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.publicMcpReleaseApproved).toBe(false);
    expect(result.stdout).not.toContain("local-private-marker");
    expect(result.stdout).not.toContain("postgresql://");
    expect(result.stderr).toBe("");
  });
});
