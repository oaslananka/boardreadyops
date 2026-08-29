import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as yaml from "js-yaml";

const PUBLIC_EXTRA_MARKDOWN_ROOTS = ["reference/plugin-sdk", "rules"];
const FULL_CONTEXT_CANDIDATES = [
  "index.md",
  "quickstart.md",
  "install.md",
  "configuration.md",
  "action.md",
  "agent-planning.md",
  "rules/index.md",
  "reports/html.md",
  "release/evidence-bundles.md",
  "security/github-app-permissions.md",
];

export async function generateDocsDiscovery({ repositoryRoot = process.cwd(), siteDir }) {
  if (!siteDir) throw new Error("siteDir is required");

  const configPath = path.join(repositoryRoot, "mkdocs.yml");
  const config = yaml.load(await readFile(configPath, "utf8"));
  if (!config || typeof config !== "object") throw new Error("mkdocs.yml must contain a mapping");

  const docsDirName = typeof config.docs_dir === "string" ? config.docs_dir : "docs";
  const docsDir = path.resolve(repositoryRoot, docsDirName);
  const siteUrl = normalizeSiteUrl(config.site_url);
  const navPaths = collectNavMarkdownPaths(config.nav);
  const extraPaths = [];
  for (const extraRoot of PUBLIC_EXTRA_MARKDOWN_ROOTS) {
    extraPaths.push(...(await collectMarkdownUnder(docsDir, extraRoot)));
  }

  const markdownPaths = deduplicate([...navPaths, ...extraPaths]).sort((left, right) => {
    const leftNav = navPaths.indexOf(left);
    const rightNav = navPaths.indexOf(right);
    if (leftNav !== -1 || rightNav !== -1) {
      if (leftNav === -1) return 1;
      if (rightNav === -1) return -1;
      return leftNav - rightNav;
    }
    return left.localeCompare(right);
  });

  const documents = [];
  for (const relativePath of markdownPaths) {
    const sourcePath = resolveInsideDocs(docsDir, relativePath);
    const content = await readFile(sourcePath, "utf8");
    const outputPath = path.join(siteDir, ...relativePath.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(sourcePath, outputPath);
    documents.push({
      relativePath,
      content,
      title: extractTitle(content, relativePath),
      markdownUrl: new URL(relativePath, siteUrl).href,
      htmlUrl: canonicalHtmlUrl(siteUrl, relativePath),
    });
  }

  const byPath = new Map(documents.map((document) => [document.relativePath, document]));
  const fullContextDocuments = FULL_CONTEXT_CANDIDATES.map((candidate) => byPath.get(candidate)).filter(Boolean);

  await writeText(siteDir, "robots.txt", buildRobotsTxt(siteUrl));
  await writeText(siteDir, "llms.txt", buildLlmsTxt(siteUrl, documents, fullContextDocuments));
  await writeText(siteDir, "llms-full.txt", buildLlmsFullTxt(siteUrl, fullContextDocuments));
  await writeText(siteDir, "AGENTS.md", buildPublicAgentsMarkdown(siteUrl));
  await writeText(siteDir, "sitemap.md", buildMarkdownSitemap(siteUrl, documents));

  return { markdownPaths, siteUrl };
}

function normalizeSiteUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("mkdocs.yml site_url is required for documentation discovery");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("mkdocs.yml site_url must use HTTPS");
  return parsed.href.endsWith("/") ? parsed.href : `${parsed.href}/`;
}

function collectNavMarkdownPaths(nav) {
  const paths = [];
  visitNav(nav, paths);
  return deduplicate(paths);
}

function visitNav(value, paths) {
  if (typeof value === "string") {
    if (value.endsWith(".md")) paths.push(normalizeRelativeMarkdownPath(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitNav(item, paths);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) visitNav(child, paths);
  }
}

async function collectMarkdownUnder(docsDir, relativeRoot) {
  const root = resolveInsideDocs(docsDir, relativeRoot, { requireMarkdown: false });
  const collected = [];
  await walk(root, relativeRoot, collected);
  return collected;
}

async function walk(absoluteDir, relativeDir, collected) {
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(absoluteDir, entry.name);
    const relative = path.posix.join(relativeDir.replaceAll(path.sep, "/"), entry.name);
    if (entry.isDirectory()) await walk(absolute, relative, collected);
    else if (entry.isFile() && entry.name.endsWith(".md")) collected.push(normalizeRelativeMarkdownPath(relative));
  }
}

function normalizeRelativeMarkdownPath(value) {
  if (path.isAbsolute(value)) throw new Error(`documentation path is outside docs_dir: ${value}`);
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`documentation path is outside docs_dir: ${value}`);
  }
  if (!normalized.endsWith(".md")) throw new Error(`documentation mirror path must be Markdown: ${value}`);
  return normalized;
}

function resolveInsideDocs(docsDir, relativePath, { requireMarkdown = true } = {}) {
  const normalized = requireMarkdown ? normalizeRelativeMarkdownPath(relativePath) : path.posix.normalize(relativePath);
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`documentation path is outside docs_dir: ${relativePath}`);
  }
  const resolved = path.resolve(docsDir, ...normalized.split("/"));
  if (resolved !== docsDir && !resolved.startsWith(`${docsDir}${path.sep}`)) {
    throw new Error(`documentation path is outside docs_dir: ${relativePath}`);
  }
  return resolved;
}

function deduplicate(values) {
  return [...new Set(values)];
}

function extractTitle(content, relativePath) {
  for (const line of content.split("\n")) {
    if (!line.startsWith("#")) continue;
    const remainder = line.slice(1);
    if (remainder.trimStart() === remainder) continue;
    const title = remainder.trim();
    if (title) return title;
  }
  const fileName = path.posix.basename(relativePath, ".md");
  return fileName === "index" || fileName === "README" ? "BoardReadyOps" : fileName.replaceAll("-", " ");
}

function canonicalHtmlUrl(siteUrl, relativePath) {
  const basename = path.posix.basename(relativePath);
  if (basename === "index.md" || basename === "README.md") {
    const directory = path.posix.dirname(relativePath);
    return directory === "." ? siteUrl : new URL(`${directory}/`, siteUrl).href;
  }
  return new URL(`${relativePath.slice(0, -3)}/`, siteUrl).href;
}

function buildRobotsTxt(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", siteUrl).href}\n`;
}

function buildLlmsTxt(siteUrl, documents, preferredDocuments) {
  const home = documents.find((document) => document.relativePath === "index.md");
  const summary = extractSummary(home?.content) ?? "BoardReadyOps documentation for KiCad hardware release readiness.";
  const selections = preferredDocuments.length > 0 ? preferredDocuments : documents.slice(0, 10);
  const links = selections.map((document) => `- [${document.title}](${document.markdownUrl})`).join("\n");
  return `# BoardReadyOps Documentation\n\n> ${summary}\n\n## Documentation\n\n${links}\n\n## Discovery\n\n- [Extended context](${new URL("llms-full.txt", siteUrl).href})\n- [Markdown sitemap](${new URL("sitemap.md", siteUrl).href})\n- [XML sitemap](${new URL("sitemap.xml", siteUrl).href})\n- [Public agent guide](${new URL("AGENTS.md", siteUrl).href})\n`;
}

function extractSummary(content) {
  if (!content) return null;
  return (
    content
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith("#") && !part.startsWith("---")) ?? null
  );
}

function buildLlmsFullTxt(siteUrl, documents) {
  const sections = documents
    .map(
      (document) =>
        `## ${document.title}\n\nCanonical HTML: ${document.htmlUrl}\nMarkdown mirror: ${document.markdownUrl}\n\n${document.content.trim()}\n`,
    )
    .join("\n---\n\n");
  return `# BoardReadyOps Documentation Context\n\n> Curated public documentation context for BoardReadyOps. Repository-maintainer and internal planning documents are intentionally excluded.\n\nSource: ${siteUrl}\n\n${sections}`;
}

function buildPublicAgentsMarkdown(siteUrl) {
  return `# BoardReadyOps public documentation guide\n\nUse this file to navigate the public BoardReadyOps documentation. It is not a repository-maintainer or production-operations instruction file.\n\n## Start here\n\n- Documentation index: ${new URL("index.md", siteUrl).href}\n- Quickstart: ${new URL("quickstart.md", siteUrl).href}\n- Configuration: ${new URL("configuration.md", siteUrl).href}\n- GitHub Action: ${new URL("action.md", siteUrl).href}\n- Agent planning output: ${new URL("agent-planning.md", siteUrl).href}\n\n## Machine-readable discovery\n\n- LLM index: ${new URL("llms.txt", siteUrl).href}\n- Extended context: ${new URL("llms-full.txt", siteUrl).href}\n- Markdown sitemap: ${new URL("sitemap.md", siteUrl).href}\n- XML sitemap: ${new URL("sitemap.xml", siteUrl).href}\n\nTreat the canonical documentation as public product guidance only. Do not infer authenticated customer data, private repository state, control-plane credentials, or operator procedures from these discovery files.\n`;
}

function buildMarkdownSitemap(siteUrl, documents) {
  const lines = documents.map(
    (document) => `- [${document.title}](${document.markdownUrl}) — [HTML](${document.htmlUrl})`,
  );
  return `# BoardReadyOps Documentation Sitemap\n\nPublic documentation pages with raw Markdown mirrors.\n\n${lines.join("\n")}\n\n- [XML sitemap](${new URL("sitemap.xml", siteUrl).href})\n`;
}

async function writeText(siteDir, relativePath, content) {
  const outputPath = path.join(siteDir, ...relativePath.split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}
