import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAppAuth } from "@octokit/auth-app";
import pg from "pg";

const endpoint = "https://api.github.com/app/hook/deliveries";
const apiVersion = "2026-03-10";
const guidPattern = /^[a-zA-Z0-9._:-]{8,128}$/u;

function boundedOption(environment, name, fallback, min, max) {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`invalid_${name.toLowerCase()}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return parsed;
}
export function auditOptions(environment = {}) {
  return {
    windowHours: boundedOption(environment, "BOARDREADYOPS_WEBHOOK_AUDIT_HOURS", 24, 1, 48),
    maxPages: boundedOption(environment, "BOARDREADYOPS_WEBHOOK_AUDIT_MAX_PAGES", 30, 1, 30),
  };
}
export function parseNextCursor(linkHeader) {
  if (!linkHeader) return null;
  const nextLink = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /;\s*rel="?next"?(?:\s*;|$)/u.test(part));
  if (!nextLink) return null;
  const match = /^<([^>]+)>/u.exec(nextLink);
  if (!match) throw new Error("invalid_github_pagination_link");
  let url;
  try {
    url = new URL(match[1]);
  } catch {
    throw new Error("invalid_github_pagination_link");
  }
  if (
    url.origin !== "https://api.github.com" ||
    url.pathname !== "/app/hook/deliveries" ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => !["cursor", "per_page"].includes(key)) ||
    (url.searchParams.has("per_page") && url.searchParams.get("per_page") !== "100")
  ) {
    throw new Error("unsafe_github_pagination_link");
  }
  const cursor = url.searchParams.get("cursor");
  if (!cursor || cursor.length > 512) throw new Error("invalid_github_pagination_cursor");
  return cursor;
}
function validatedDelivery(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_github_delivery");
  const { id, guid, status_code: statusCode, delivered_at: deliveredAt } = item;
  const date = typeof deliveredAt === "string" ? Date.parse(deliveredAt) : Number.NaN;
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof guid !== "string" ||
    !guidPattern.test(guid) ||
    !Number.isInteger(statusCode) ||
    statusCode < 0 ||
    statusCode > 599 ||
    !Number.isFinite(date)
  ) {
    throw new Error("invalid_github_delivery");
  }
  return { id, guid, statusCode, deliveredAt: date };
}
async function readGitHubDeliveryPage(response) {
  if (!response.ok) throw new Error(`github_delivery_request_failed_${response.status}`);
  let rows;
  try {
    rows = await response.json();
  } catch {
    throw new Error("invalid_github_delivery_response");
  }
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("invalid_github_delivery_response");
  return rows.map(validatedDelivery);
}
export async function fetchRecentAppWebhookDeliveries({ token, since, maxPages = 30, request = fetch }) {
  const cutoff = Date.parse(since);
  if (!Number.isFinite(cutoff) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 30) {
    throw new Error("invalid_github_audit_bounds");
  }
  if (typeof token !== "string" || !token) throw new Error("missing_app_jwt");
  const seen = new Map();
  let nextCursor = null;
  let pages = 0;
  for (; pages < maxPages; pages += 1) {
    const url = new URL(endpoint);
    url.searchParams.set("per_page", "100");
    if (nextCursor !== null) url.searchParams.set("cursor", nextCursor);
    const response = await request(url.toString(), {
      method: "GET",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": apiVersion,
      },
      signal: AbortSignal.timeout(10_000),
    });
    for (const delivery of await readGitHubDeliveryPage(response)) {
      const prior = seen.get(delivery.id);
      if (prior && (prior.guid !== delivery.guid || prior.statusCode !== delivery.statusCode)) {
        throw new Error("conflicting_github_delivery_identity");
      }
      if (delivery.deliveredAt >= cutoff) seen.set(delivery.id, delivery);
    }
    nextCursor = parseNextCursor(response.headers.get("link"));
    if (nextCursor === null) return { attempts: [...seen.values()], complete: true, pages: pages + 1 };
  }
  return { attempts: [...seen.values()], complete: false, pages };
}
export function deliveryGapSummary(attempts, inboxGuids, complete) {
  const groups = new Map();
  let failedAttempts = 0;
  for (const attempt of attempts) {
    const existing = groups.get(attempt.guid) ?? { failures: [], successful: false };
    if (attempt.statusCode >= 200 && attempt.statusCode < 400) {
      existing.successful = true;
    } else {
      existing.failures.push(attempt.id);
      failedAttempts += 1;
    }
    groups.set(attempt.guid, existing);
  }
  let failuresAlreadyStored = 0;
  let failuresWithNoInbox = 0;
  let unresolvedAfterSuccess = 0;
  const review = [];
  for (const [guid, outcome] of groups) {
    if (outcome.failures.length === 0) continue;
    if (inboxGuids.has(guid)) {
      failuresAlreadyStored += 1;
    } else if (outcome.successful) {
      unresolvedAfterSuccess += 1;
      review.push({ deliveryId: Math.min(...outcome.failures), guid, category: "successful_retry_without_inbox" });
    } else {
      failuresWithNoInbox += 1;
      review.push({ deliveryId: Math.min(...outcome.failures), guid, category: "failed_not_stored" });
    }
  }
  review.sort((a, b) => a.deliveryId - b.deliveryId);
  return {
    complete,
    attempts: attempts.length,
    failedAttempts,
    failedEvents: failuresAlreadyStored + failuresWithNoInbox + unresolvedAfterSuccess,
    failuresAlreadyStored,
    failuresWithNoInbox,
    unresolvedAfterSuccess,
    needsReview: !complete || review.length > 0,
    review,
  };
}

async function readExistingInboxGuids(databaseUrl, guids) {
  if (guids.length === 0) return new Set();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "boardreadyops-webhook-delivery-readonly-audit",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      "SELECT delivery_id FROM webhook_inbox WHERE provider = 'github' AND delivery_id = ANY($1::text[])",
      [guids],
    );
    await client.query("COMMIT");
    return new Set(result.rows.map((row) => String(row.delivery_id)));
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw new Error("read_only_webhook_inbox_query_failed");
  } finally {
    client?.release();
    await pool.end();
  }
}
function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

export async function runWebhookDeliveryAudit(environment = process.env, dependencies = {}) {
  const options = auditOptions(environment);
  const appId = required(environment, "GITHUB_APP_ID");
  const privateKey = required(environment, "GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n");
  const databaseUrl = required(environment, "DATABASE_URL");
  if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) throw new Error("invalid_database_url");
  const authenticate = dependencies.authenticate ?? createAppAuth({ appId, privateKey });
  const authorization = await authenticate({ type: "app" });
  if (!authorization?.token) throw new Error("missing_app_jwt");
  const now = dependencies.now?.() ?? Date.now();
  const since = new Date(now - options.windowHours * 3_600_000).toISOString();
  const deliveries = await fetchRecentAppWebhookDeliveries({
    token: authorization.token,
    since,
    maxPages: options.maxPages,
    ...(dependencies.request ? { request: dependencies.request } : {}),
  });
  const failedGuids = [
    ...new Set(
      deliveries.attempts
        .filter((attempt) => attempt.statusCode < 200 || attempt.statusCode >= 400)
        .map((attempt) => attempt.guid),
    ),
  ];
  const recorded = dependencies.lookupInbox
    ? await dependencies.lookupInbox(failedGuids)
    : await readExistingInboxGuids(databaseUrl, failedGuids);
  const result = deliveryGapSummary(deliveries.attempts, recorded, deliveries.complete);
  const summary = {
    event: "github_app_webhook_delivery_readonly_audit",
    windowHours: options.windowHours,
    scanPages: deliveries.pages,
    ...result,
  };
  const reportPath = environment.BOARDREADYOPS_WEBHOOK_AUDIT_REPORT_PATH?.trim();
  if (reportPath) {
    try {
      await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      throw new Error("private_audit_report_write_failed");
    }
  }
  return summary;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const report = await runWebhookDeliveryAudit();
    const { review: _privateReview, ...aggregate } = report;
    process.stdout.write(`${JSON.stringify(aggregate)}\n`);
    if (!report.complete) process.exitCode = 3;
    else if (report.needsReview) process.exitCode = 2;
  } catch (error) {
    const known =
      error instanceof Error &&
      /^(?:missing_|invalid_|unsafe_|conflicting_|github_delivery_request_failed_|read_only_webhook_inbox_query_failed|private_audit_report_write_failed)/u.test(
        error.message,
      );
    process.stderr.write(
      `${JSON.stringify({
        event: "github_app_webhook_delivery_audit_failed",
        code: known ? error.message : "unexpected_error",
      })}\n`,
    );
    process.exitCode = 4;
  }
}
