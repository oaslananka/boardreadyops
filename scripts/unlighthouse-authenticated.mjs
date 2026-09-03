import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAuthenticatedRoutes } from "./unlighthouse-auth-routes.mjs";

const defaultSite = "https://boardreadyops.com";
const outputRoot = ".unlighthouse/authenticated";
const manifestPath = ".unlighthouse/authenticated-routes.json";
const budgets = { performance: 70, accessibility: 90, "best-practices": 85 };
const categories = ["performance", "accessibility", "best-practices"];

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseAuthenticatedAuditOptions(environment = process.env, argv = process.argv.slice(2)) {
  const session = environment.BROPS_SESSION?.trim();
  if (!session) throw new Error("BROPS_SESSION is required");

  const url = new URL(environment.BROPS_UNLIGHTHOUSE_SITE || defaultSite);
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

export function buildAuthenticatedUnlighthouseConfig({ site, session, routes, headful = false }) {
  return {
    site,
    urls: routes,
    discovery: false,
    outputPath: outputRoot,
    cache: false,
    cookies: [{ name: "brops_session", value: session, domain: new URL(site).hostname, path: "/" }],
    scanner: {
      device: "desktop",
      samples: 1,
      crawler: false,
      robotsTxt: false,
      sitemap: false,
      dynamicSampling: false,
      skipJavascript: false,
    },
    puppeteerClusterOptions: { maxConcurrency: 1 },
    puppeteerOptions: { headless: !headful },
    lighthouseOptions: {
      disableStorageReset: true,
      onlyCategories: categories,
    },
    ci: { budget: budgets, buildStatic: true },
  };
}

function evaluateBudgetFailures(reports) {
  const failures = [];
  for (const report of reports) {
    const reportCategories = report.report?.categories ?? {};
    for (const [category, details] of Object.entries(reportCategories)) {
      const minimum = budgets[category];
      if (minimum === undefined || typeof details?.score !== "number") continue;
      const score = Math.round(details.score * 100);
      if (score < minimum) failures.push({ path: report.route?.path ?? "unknown", category, score, minimum });
    }
  }
  return failures;
}

async function defaultWriteManifest(payload) {
  await mkdir(resolve(".unlighthouse"), { recursive: true });
  await writeFile(resolve(manifestPath), payload, { encoding: "utf8", mode: 0o600 });
}

export async function runAuthenticatedAudit({
  environment = process.env,
  argv = process.argv.slice(2),
  discoverImpl = discoverAuthenticatedRoutes,
  writeManifestImpl = defaultWriteManifest,
  coreImpl,
} = {}) {
  const options = parseAuthenticatedAuditOptions(environment, argv);
  const manifest = await discoverImpl({ site: options.site, session: options.session });
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeManifestImpl(payload);

  if (options.routesOnly) return { exitCode: 0, manifest, budgetFailures: [] };

  const core = coreImpl ?? (await import("@unlighthouse/core"));
  const config = buildAuthenticatedUnlighthouseConfig({ ...options, routes: manifest.routes });
  const context = await core.createUnlighthouse(config, { name: "authenticated-ci" });
  let resolveFinished;
  const finished = new Promise((resolvePromise) => {
    resolveFinished = resolvePromise;
  });

  context.hooks.hook("worker-finished", async () => resolveFinished());
  await context.setCiContext();
  const started = await context.start();
  if (!started.routes?.length) throw new Error("Unlighthouse did not queue any authenticated routes");
  await finished;

  const reports = context.worker.reports();
  const budgetFailures = evaluateBudgetFailures(reports);
  await core.generateClient({ static: true }, context);

  return {
    exitCode: budgetFailures.length === 0 ? 0 : 1,
    manifest,
    budgetFailures,
    reportPath: outputRoot,
  };
}

async function main() {
  const result = await runAuthenticatedAudit();
  process.stdout.write(`Authenticated UI audit routes: ${result.manifest.routes.length}\n`);
  if (result.reportPath) process.stdout.write(`Authenticated UI audit report: ${result.reportPath}\n`);

  for (const failure of result.budgetFailures) {
    process.stderr.write(`Budget failed: ${failure.path} ${failure.category} ${failure.score} < ${failure.minimum}\n`);
  }
  process.exitCode = result.exitCode;
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Authenticated UI audit failed"}\n`);
    process.exitCode = 1;
  });
}
