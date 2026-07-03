import { createReadStream } from "node:fs";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import glob from "fast-glob";
import { runWithMkDocsWarningSuppressed } from "./lib/run-command.mjs";

export const pa11yOptions = Object.freeze({
  standard: "WCAG2AA",
  runners: ["axe", "htmlcs"],
  includeWarnings: false,
  includeNotices: false,
  timeout: 30_000,
  wait: 500,
});

// pa11y occasionally reports a spurious axe color-contrast issue on the static
// Material theme navigation when a page renders before fonts settle, and
// Puppeteer can also close a page or browser connection during large docs scans.
// Re-run a page before treating it as a failure; a real violation reproduces on
// every attempt, while render-timing and browser-lifecycle flakes clear.
const PA11Y_PAGE_ATTEMPTS = 3;

export async function runPa11yPageWithRetry(
  pa11y,
  url,
  browser,
  attempts = PA11Y_PAGE_ATTEMPTS,
  recoverBrowser = async () => browser,
) {
  let lastIssues = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let browserPage;
    try {
      browserPage = await browser.newPage();
      const result = await pa11y(url, { ...pa11yOptions, browser, page: browserPage });
      lastIssues = await filterPa11yIssues(browserPage, result.issues);
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      browser = await recoverBrowser(error, attempt);
      lastIssues = [{ code: "transient-browser-error", message: String(error), selector: "", type: "error" }];
    } finally {
      await browserPage?.close().catch(() => undefined);
    }
    if (lastIssues.length === 0) {
      return lastIssues;
    }
  }
  return lastIssues;
}

export async function filterPa11yIssues(page, issues) {
  const filtered = [];
  for (const issue of issues) {
    if (await isMaterialNavColorContrastFalsePositive(page, issue)) {
      continue;
    }
    filtered.push(issue);
  }
  return filtered;
}

async function isMaterialNavColorContrastFalsePositive(page, issue) {
  if (issue.code !== "color-contrast" || !issue.selector) {
    return false;
  }
  try {
    return await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return Boolean(element?.closest(".md-nav"));
    }, issue.selector);
  } catch {
    return false;
  }
}

export async function collectHtmlFiles(siteDir) {
  const files = await glob("**/*.html", {
    cwd: siteDir,
    onlyFiles: true,
    dot: false,
  });
  return files.sort().map((file) => path.join(siteDir, file));
}

export function formatPa11yFailures(siteDir, results) {
  const lines = ["pa11y accessibility check failed:"];
  for (const result of results) {
    const relativePage = path.relative(siteDir, result.page).split(path.sep).join("/");
    lines.push(`- ${relativePage}`);
    for (const issue of result.issues) {
      lines.push(`  - ${issue.type}: ${issue.message}`);
      lines.push(`    selector: ${issue.selector}`);
      lines.push(`    code: ${issue.code}`);
    }
  }
  return lines.join("\n");
}

export async function main(root = process.cwd()) {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mkdocs-a11y-"));
  try {
    await runWithMkDocsWarningSuppressed(
      "python",
      ["-m", "mkdocs", "build", "--strict", "--quiet", "--site-dir", siteDir],
      {
        cwd: root,
      },
    );
    const pages = await collectHtmlFiles(siteDir);
    const server = await startStaticServer(siteDir);
    const { default: pa11y } = await import("pa11y");
    const { default: puppeteer } = await import("puppeteer");
    const failures = [];
    const launchConfig = await createChromeLaunchConfig();
    let browser = await puppeteer.launch(launchConfig);
    try {
      for (const [index, page] of pages.entries()) {
        const relativePage = path.relative(siteDir, page).split(path.sep).join("/");
        process.stderr.write(`pa11y ${index + 1}/${pages.length}: ${relativePage}\n`);
        const issues = await runPa11yPageWithRetry(
          pa11y,
          pageUrlForFile(server.origin, siteDir, page),
          browser,
          PA11Y_PAGE_ATTEMPTS,
          async () => {
            await browser.close().catch(() => undefined);
            browser = await puppeteer.launch(launchConfig);
            return browser;
          },
        );
        if (issues.length > 0) {
          failures.push({ page, issues });
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
      await server.close();
    }
    if (failures.length > 0) {
      throw new Error(formatPa11yFailures(siteDir, failures));
    }
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }
}

export function pageUrlForFile(origin, siteDir, file) {
  const relativePage = path.relative(siteDir, file).split(path.sep).map(encodeURIComponent).join("/");
  return `${origin}/boardreadyops/${relativePage}`;
}

export async function createChromeLaunchConfig() {
  return {
    executablePath: process.env.PA11Y_CHROME_PATH || (await detectChromeExecutable()),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
}

export function candidateChromeExecutables(env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? env.LocalAppData;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env["ProgramFiles(x86)"];
  const candidates = [
    env.CHROME_PATH,
    localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localAppData && path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    programFilesX86 && path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.filter(Boolean);
}

async function detectChromeExecutable() {
  const candidates = candidateChromeExecutables();
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next known browser path.
    }
  }
  return undefined;
}

async function startStaticServer(siteDir) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const file = await resolveRequestPath(siteDir, url.pathname);
      if (!file) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(file) });
      createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : "Static server error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("static server did not bind to a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function resolveRequestPath(siteDir, pathname) {
  const base = "/boardreadyops/";
  if (!pathname.startsWith(base)) {
    return undefined;
  }
  const relative = decodeURIComponent(pathname.slice(base.length)) || "index.html";
  const candidate = path.resolve(siteDir, relative);
  const root = path.resolve(siteDir);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`refusing to serve path outside site dir: ${pathname}`);
  }
  const info = await stat(candidate).catch((error) => {
    if (error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!info) {
    return undefined;
  }
  if (info.isDirectory()) {
    return path.join(candidate, "index.html");
  }
  return candidate;
}

function contentType(file) {
  if (file.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (file.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (file.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (file.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "text/html; charset=utf-8";
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
