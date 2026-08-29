import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneWebRoot = path.join(repositoryRoot, "apps/web/.next/standalone/apps/web");
const standaloneServer = path.join(standaloneWebRoot, "server.js");
const minimumVisibleTextRatio = 0.15;

export function visibleTextRatio(html) {
  const window = new Window({ url: "https://boardreadyops.com/" });
  window.document.write(html);
  for (const selector of ["script", "style", "noscript", "svg"]) {
    for (const node of window.document.querySelectorAll(selector)) node.remove();
  }
  const visibleText = (window.document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  return Buffer.byteLength(visibleText, "utf8") / Buffer.byteLength(html, "utf8");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  invariant(address && typeof address === "object", "failed to reserve a local verification port");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 20_000;
  let lastErrorMessage = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`standalone web server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch (error) {
      lastErrorMessage = errorMessage(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const detail = lastErrorMessage ? `: ${lastErrorMessage}` : "";
  throw new Error(`timed out waiting for standalone web server${detail}`);
}

function parseHtml(html) {
  const window = new Window({ url: "https://boardreadyops.com/" });
  window.document.write(html);
  return window.document;
}

export async function verifyPublicAgentReadability(baseUrl) {
  const home = await fetch(`${baseUrl}/`);
  invariant(home.status === 200, `homepage returned ${home.status}`);
  invariant(home.headers.get("content-type")?.includes("text/html"), "homepage did not return HTML");
  invariant(
    home.headers.get("link")?.includes('</llms.txt>; rel="describedby"'),
    "homepage missing llms describedby Link header",
  );
  invariant(home.headers.get("vary")?.toLowerCase().includes("accept"), "homepage missing Vary: Accept");
  const html = await home.text();
  const document = parseHtml(html);
  invariant(document.documentElement.lang === "en", "homepage html lang is not en");
  invariant(document.querySelector('link[rel="canonical"]') !== null, "homepage missing canonical link");
  invariant(
    document.querySelector('link[rel="alternate"][type="text/markdown"]') !== null,
    "homepage missing Markdown alternate link",
  );
  invariant(document.querySelectorAll("h1,h2,h3,h4,h5,h6").length >= 3, "homepage has fewer than three headings");
  invariant(document.querySelector('a[href="#glossary"]') !== null, "homepage missing visible glossary link");
  invariant(document.querySelector('a[href="/openapi.json"]') !== null, "homepage missing OpenAPI link");
  const jsonLd = document.querySelector('script[type="application/ld+json"]')?.textContent;
  invariant(jsonLd, "homepage missing JSON-LD");
  const structured = JSON.parse(jsonLd);
  invariant(Array.isArray(structured["@graph"]), "homepage JSON-LD graph is invalid");

  const ratio = visibleTextRatio(html);
  invariant(
    ratio >= minimumVisibleTextRatio,
    `homepage visible-text/HTML ratio ${(ratio * 100).toFixed(2)}% is below ${(minimumVisibleTextRatio * 100).toFixed(0)}%`,
  );

  const markdown = await fetch(`${baseUrl}/`, { headers: { Accept: "text/markdown" } });
  invariant(markdown.status === 200, `negotiated Markdown returned ${markdown.status}`);
  invariant(
    markdown.headers.get("content-type")?.includes("text/markdown"),
    "negotiated representation is not Markdown",
  );
  invariant(markdown.headers.get("vary")?.toLowerCase().includes("accept"), "negotiated Markdown missing Vary: Accept");
  invariant(
    markdown.headers.get("link")?.includes('rel="canonical"'),
    "negotiated Markdown missing canonical Link header",
  );
  invariant((await markdown.text()).includes("## Sitemap"), "negotiated Markdown missing Sitemap section");

  const discovery = [
    { pathname: "/robots.txt", contentType: "text/plain" },
    { pathname: "/sitemap.xml", contentType: "application/xml" },
    { pathname: "/sitemap.md", contentType: "text/markdown" },
    { pathname: "/llms.txt", contentType: "text/plain" },
    { pathname: "/llms-full.txt", contentType: "text/plain" },
    { pathname: "/AGENTS.md", contentType: "text/markdown" },
    { pathname: "/index.md", contentType: "text/markdown" },
    { pathname: "/openapi.json", contentType: "application/json" },
  ];
  for (const { pathname, contentType } of discovery) {
    const response = await fetch(`${baseUrl}${pathname}`);
    invariant(response.status === 200, `${pathname} returned ${response.status}`);
    invariant(
      response.headers.get("content-type")?.includes(contentType),
      `${pathname} returned unexpected content type`,
    );
  }

  const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
  const openApi = await openApiResponse.json();
  invariant(typeof openApi.openapi === "string" && openApi.openapi.startsWith("3.1."), "OpenAPI version is not 3.1.x");
  invariant(
    JSON.stringify(Object.keys(openApi.paths).sort((left, right) => left.localeCompare(right))) ===
      JSON.stringify(["/api/health/live", "/api/health/ready"]),
    "OpenAPI path allowlist changed",
  );

  return { ratio, htmlBytes: Buffer.byteLength(html, "utf8") };
}

async function main() {
  invariant(existsSync(standaloneServer), "standalone web build is missing; run the web build before this verifier");
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: standaloneWebRoot,
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    if (stdout.length < 32_000) stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 32_000) stderr += chunk.toString();
  });
  try {
    await waitForServer(baseUrl, child);
    const result = await verifyPublicAgentReadability(baseUrl);
    process.stdout.write(
      `public_agent_readability_pass ratio=${(result.ratio * 100).toFixed(2)} html_bytes=${result.htmlBytes}\n`,
    );
  } catch (error) {
    if (stdout.trim()) process.stderr.write(`${stdout.trim()}\n`);
    if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
    throw error;
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
