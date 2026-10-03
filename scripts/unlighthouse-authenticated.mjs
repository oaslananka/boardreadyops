import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch as launchChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import { firstAccessiblePath } from "./lib/files.mjs";
import { discoverAuthenticatedRoutes } from "./unlighthouse-auth-routes.mjs";

const defaultSite = "https://boardreadyops.com";
const outputRoot = ".unlighthouse/authenticated";
const manifestPath = ".unlighthouse/authenticated-routes.json";
const budgets = { performance: 70, accessibility: 90, "best-practices": 85 };
const categories = ["performance", "accessibility", "best-practices"];
const knownChromePaths = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseAuthenticatedAuditOptions(environment = process.env, argv = process.argv.slice(2)) {
  const session = environment.BROPS_SESSION?.trim();
  if (!session) throw new Error("BROPS_SESSION is required");

  const url = new URL(environment.BROPS_UNLIGHTHOUSE_SITE || defaultSite);
  if (url.hostname !== "boardreadyops.com" && !isLoopback(url.hostname)) {
    throw new Error("BROPS_UNLIGHTHOUSE_SITE must target boardreadyops.com or loopback");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("BROPS_UNLIGHTHOUSE_SITE must use HTTPS unless it targets loopback");
  }

  return {
    site: url.origin,
    session,
    routesOnly: argv.includes("--routes-only"),
    headful: argv.includes("--debug"),
  };
}

export function buildAuthenticatedLighthouseFlags({ session, port, headful = false }) {
  return {
    port,
    logLevel: "error",
    output: "json",
    onlyCategories: categories,
    disableStorageReset: true,
    formFactor: "desktop",
    screenEmulation: { disabled: true },
    extraHeaders: { Cookie: `brops_session=${session}` },
    ...(headful ? { throttlingMethod: "provided" } : {}),
  };
}

export function evaluateBudgetFailures(routeReports) {
  const failures = [];
  for (const report of routeReports) {
    for (const [category, minimum] of Object.entries(budgets)) {
      const score = report.scores?.[category];
      if (typeof score !== "number") continue;
      if (score < minimum) failures.push({ path: report.path, category, score, minimum });
    }
  }
  return failures;
}

async function defaultWriteManifest(payload) {
  await mkdir(resolve(".unlighthouse"), { recursive: true });
  await writeFile(resolve(manifestPath), payload, { encoding: "utf8", mode: 0o600 });
}

async function defaultWriteAuditSummary(summary) {
  await mkdir(resolve(outputRoot), { recursive: true });
  await writeFile(resolve(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function detectInstalledChrome(paths = knownChromePaths) {
  return firstAccessiblePath(paths);
}

function scoreCategories(lhr) {
  return Object.fromEntries(
    categories.map((category) => {
      const score = lhr?.categories?.[category]?.score;
      return [category, typeof score === "number" ? Math.round(score * 100) : null];
    }),
  );
}

export async function runAuthenticatedAudit({
  environment = process.env,
  argv = process.argv.slice(2),
  discoverImpl = discoverAuthenticatedRoutes,
  writeManifestImpl = defaultWriteManifest,
  writeAuditSummaryImpl = defaultWriteAuditSummary,
  lighthouseImpl = lighthouse,
  launchChromeImpl = launchChrome,
  detectChromeImpl = detectInstalledChrome,
} = {}) {
  const options = parseAuthenticatedAuditOptions(environment, argv);
  const manifest = await discoverImpl({ site: options.site, session: options.session });
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeManifestImpl(payload);

  if (options.routesOnly) return { exitCode: 0, manifest, budgetFailures: [], scanFailures: [] };

  const chromePath = await detectChromeImpl();
  if (!chromePath) throw new Error("Installed Chrome is required for authenticated Lighthouse audit");

  const chrome = await launchChromeImpl({
    chromePath,
    chromeFlags: [
      ...(options.headful ? [] : ["--headless=new"]),
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
    ],
  });

  const reports = [];
  const scanFailures = [];
  try {
    for (const route of manifest.routes) {
      const url = new URL(route, options.site).href;
      let result;
      try {
        result = await lighthouseImpl(
          url,
          buildAuthenticatedLighthouseFlags({
            session: options.session,
            port: chrome.port,
            headful: options.headful,
          }),
        );
      } catch (error) {
        scanFailures.push({
          path: route,
          status: error instanceof Error ? error.message : "lighthouse failed",
        });
        continue;
      }

      if (!result?.lhr) {
        scanFailures.push({ path: route, status: "missing Lighthouse result" });
        continue;
      }
      reports.push({ path: route, scores: scoreCategories(result.lhr) });
    }
  } finally {
    await chrome.kill();
  }

  const budgetFailures = evaluateBudgetFailures(reports);
  const summary = {
    site: manifest.site,
    generatedAt: manifest.generatedAt,
    routes: reports,
    scanFailures,
    budgetFailures,
  };
  const serialized = JSON.stringify(summary);
  if (serialized.includes(options.session)) {
    throw new Error("Authenticated audit summary unexpectedly contains the session");
  }
  await writeAuditSummaryImpl(summary);

  return {
    exitCode: budgetFailures.length === 0 && scanFailures.length === 0 ? 0 : 1,
    manifest,
    budgetFailures,
    scanFailures,
    reportPath: outputRoot,
  };
}

async function main() {
  const result = await runAuthenticatedAudit();
  process.stdout.write(`Authenticated UI audit routes: ${result.manifest.routes.length}\n`);
  if (result.reportPath) process.stdout.write(`Authenticated UI audit report: ${result.reportPath}\n`);

  for (const failure of result.scanFailures) {
    process.stderr.write(`Scan failed: ${failure.path} (${failure.status})\n`);
  }
  for (const failure of result.budgetFailures) {
    process.stderr.write(`Budget failed: ${failure.path} ${failure.category} ${failure.score} < ${failure.minimum}\n`);
  }
  process.exitCode = result.exitCode;
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Authenticated UI audit failed"}\n`);
    process.exitCode = 1;
  }
}
