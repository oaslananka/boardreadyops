/**
 * Read-only, redacted preflight for #1248's hosted MCP release.
 * NEVER enables /mcp, registers clients, issues tokens, or grants permission.
 * Manual live GitHub-user and AI-client acceptance deliberately cannot pass here.
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";

const expectedIssuer = "https://boardreadyops.com";
const idPattern = /^[A-Za-z0-9_-]{8,128}$/u;
const opaqueClientPattern = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,127}$/u;
const rsaBase64Url = /^[A-Za-z0-9_-]{342,1024}$/u;
const exponentBase64Url = /^[A-Za-z0-9_-]{3,12}$/u;

function canonicalHttps(value) {
  if (typeof value !== "string" || value.length > 2048 || /%(?![0-9a-fA-F]{2})/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && url.href === value;
  } catch {
    return false;
  }
}

function checkSigning(environment) {
  if (!idPattern.test(environment.BOARDREADYOPS_REMOTE_MCP_KEY_ID ?? "")) return false;
  try {
    const privateKey = createPrivateKey(
      (environment.BOARDREADYOPS_REMOTE_MCP_RSA_PRIVATE_KEY ?? "").replaceAll(String.raw`\n`, "\n"),
    );
    if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      return false;
    const retired = environment.BOARDREADYOPS_REMOTE_MCP_PREVIOUS_PUBLIC_JWKS;
    if (!retired) return true;
    if (retired.length > 12000) return false;
    const document = JSON.parse(retired);
    if (
      !document ||
      Array.isArray(document) ||
      typeof document !== "object" ||
      Object.keys(document).length !== 1 ||
      !Array.isArray(document.keys) ||
      document.keys.length > 3
    )
      return false;
    const known = new Set([environment.BOARDREADYOPS_REMOTE_MCP_KEY_ID]);
    for (const candidate of document.keys) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        Object.keys(candidate).some((name) => !["kty", "kid", "alg", "use", "n", "e"].includes(name)) ||
        candidate.kty !== "RSA" ||
        candidate.alg !== "RS256" ||
        candidate.use !== "sig" ||
        !idPattern.test(candidate.kid) ||
        known.has(candidate.kid) ||
        typeof candidate.n !== "string" ||
        !rsaBase64Url.test(candidate.n) ||
        typeof candidate.e !== "string" ||
        !exponentBase64Url.test(candidate.e)
      )
        return false;
      const key = createPublicKey({ key: { kty: "RSA", n: candidate.n, e: candidate.e }, format: "jwk" });
      if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return false;
      known.add(candidate.kid);
    }
    return true;
  } catch {
    return false;
  }
}

function checkAppIdentity(environment) {
  if (!/^[1-9][0-9]{0,15}$/u.test(environment.GITHUB_APP_ID ?? "")) return false;
  try {
    const key = createPrivateKey((environment.GITHUB_APP_PRIVATE_KEY ?? "").replaceAll(String.raw`\n`, "\n"));
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return false;
    const api = environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com";
    const url = new URL(api);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.href === api || url.href === `${api}/`)
    );
  } catch {
    return false;
  }
}

const dbTables = [
  "remote_mcp_oauth_grants",
  "remote_mcp_oauth_clients",
  "remote_mcp_oauth_authorizations",
  "remote_mcp_oauth_rate_limits",
  "remote_mcp_oauth_security_events",
  "remote_mcp_oauth_login_resumptions",
];
const dbIndexes = ["remote_mcp_oauth_grants_expiry_idx", "remote_mcp_oauth_authorizations_expiry_idx"];

/** Only fixed reason codes and status values can leave this evaluator. Neither
 * SQL diagnostics nor client identifiers/redirect URLs are ever returned.
 * query is an explicitly provided READ-ONLY executor; an absent one is pending.
 */
export async function inspectRemoteMcpReleasePrerequisites(environment, query) {
  const checks = [];
  const add = (id, status) => checks.push({ id, status });
  add("oauth_release_switch", environment.BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED === "true" ? "configured" : "blocked");
  add("mcp_release_switch", environment.BOARDREADYOPS_REMOTE_MCP_HANDLER_READY === "true" ? "configured" : "blocked");
  add("issuer", environment.BOARDREADYOPS_REMOTE_MCP_OAUTH_ISSUER === expectedIssuer ? "configured" : "blocked");
  add("browser_session_secret", (environment.SESSION_SECRET?.trim().length ?? 0) >= 32 ? "configured" : "blocked");
  add("oauth_rsa_signing_and_rotation", checkSigning(environment) ? "configured" : "blocked");
  add("github_app_signing_configuration", checkAppIdentity(environment) ? "configured" : "blocked");

  if (!query) {
    add("oauth_database_schema", "not_checked");
    add("enabled_exact_client_registrations", "not_checked");
  } else {
    try {
      const names = [...dbTables, ...dbIndexes];
      const q = await query(
        `select ${names.map((_, i) => `to_regclass($${i + 1}::text) is not null as p${i}`).join(", ")}`,
        names.map((name) => `public.${name}`),
      );
      const found = q?.rows?.[0];
      const allPresent = found && names.every((_, i) => found[`p${i}`] === true);
      add("oauth_database_schema", allPresent ? "configured" : "blocked");
      if (!allPresent) {
        add("enabled_exact_client_registrations", "blocked");
      } else {
        const rows = await query(
          "select client_id, redirect_uri, display_name, enabled from remote_mcp_oauth_clients limit 101",
        );
        const entries = rows?.rows;
        const enabled = Array.isArray(entries) ? entries.filter((row) => row.enabled === true) : [];
        const valid =
          Array.isArray(entries) &&
          entries.length <= 100 &&
          enabled.length > 0 &&
          enabled.every(
            (row) =>
              (opaqueClientPattern.test(row.client_id) || canonicalHttps(row.client_id)) &&
              canonicalHttps(row.redirect_uri) &&
              typeof row.display_name === "string" &&
              row.display_name.length > 0 &&
              row.display_name.length <= 128,
          );
        add("enabled_exact_client_registrations", valid ? "configured" : "blocked");
      }
    } catch {
      // Do not expose SQL diagnostics, connection strings or stored client data.
      add("oauth_database_schema", "blocked");
      add("enabled_exact_client_registrations", "blocked");
    }
  }
  // External acceptance cannot be inferred from flags, schema or test fixtures.
  add("live_installation_user_collaborator_permission", "manual_required");
  add("live_chatgpt_oauth_mcp_exchange", "manual_required");
  add("live_claude_oauth_mcp_exchange", "manual_required");
  return { schemaVersion: 1, publicMcpReleaseApproved: false, checks };
}

async function runCli(args, environment) {
  if (args.some((arg) => arg !== "--database")) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, publicMcpReleaseApproved: false, error: "invalid_arguments" })}\n`,
    );
    return 2;
  }
  let client;
  try {
    let query;
    if (args.includes("--database") && environment.DATABASE_URL) {
      const { default: pg } = await import("pg");
      client = new pg.Client({
        connectionString: environment.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        statement_timeout: 5000,
      });
      await client.connect();
      await client.query("begin transaction read only");
      query = (sql, values) => client.query(sql, values);
    }
    const report = await inspectRemoteMcpReleasePrerequisites(environment, query);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    // Connection diagnostics may contain credentials. Never include them.
    const report = await inspectRemoteMcpReleasePrerequisites(environment);
    report.checks = report.checks.map((check) =>
      check.id === "oauth_database_schema" || check.id === "enabled_exact_client_registrations"
        ? { ...check, status: "blocked" }
        : check,
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await client?.query("rollback").catch(() => undefined);
    await client?.end().catch(() => undefined);
  }
  // Explicitly cannot approve a public release; human acceptance is mandatory.
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const exitCode = await runCli(process.argv.slice(2), process.env);
  process.exitCode = exitCode;
}
