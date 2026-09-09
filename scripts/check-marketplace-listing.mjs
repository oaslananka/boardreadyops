import { access, readFile } from "node:fs/promises";
import path from "node:path";
import * as yaml from "js-yaml";

const root = process.cwd();
const actionPath = path.join(root, "action.yml");
const readmePath = path.join(root, "README.md");
const requiredBadgeLink = "https://github.com/marketplace/actions/boardreadyops";
const failures = [];

const action = yaml.load(await readFile(actionPath, "utf8"));
const readme = await readFile(readmePath, "utf8");

checkActionMetadata(action);
checkMarketplaceBadge(readme);
await checkReadmeLinks(readme);

if (failures.length > 0) {
  const failureList = failures.map((entry) => `- ${entry}`).join("\n");
  throw new Error(`Marketplace listing validation failed:\n${failureList}`);
}

function checkActionMetadata(metadata) {
  const branding = objectValue(metadata?.branding);
  const description = stringValue(metadata?.description).trim();
  if (!stringValue(branding?.icon).trim()) {
    failures.push("action.yml must define branding.icon");
  }
  if (!stringValue(branding?.color).trim()) {
    failures.push("action.yml must define branding.color");
  }
  if (description.length < 50 || description.length > 125) {
    failures.push("action.yml description must be between 50 and 125 characters");
  }
}

function checkMarketplaceBadge(markdown) {
  const badges = markdown.matchAll(/\[!\[GitHub Marketplace\]\([^)]+\)\]\(([^)]+)\)/g);
  if (![...badges].some((match) => match[1]?.trim() === requiredBadgeLink)) {
    failures.push("README.md must link the GitHub Marketplace badge to the BoardReadyOps listing");
  }
  if (!markdown.includes("![GitHub Marketplace]")) {
    failures.push("README.md must include the GitHub Marketplace badge image");
  }
}

function markdownLinkDestinations(markdown) {
  const destinations = [];
  let offset = 0;
  while (offset < markdown.length) {
    const open = markdown.indexOf("](", offset);
    if (open < 0) break;
    const close = markdown.indexOf(")", open + 2);
    if (close < 0) break;
    destinations.push(markdown.slice(open + 2, close));
    offset = close + 1;
  }
  return destinations;
}

async function checkReadmeLinks(markdown) {
  for (const destination of markdownLinkDestinations(markdown)) {
    const link = destination.trim();
    if (!link || link.startsWith("#") || link.startsWith("mailto:")) {
      continue;
    }
    if (/^https?:\/\//.test(link)) {
      assertAbsoluteUrl(link);
      continue;
    }
    await assertLocalTarget(link);
  }
}

function assertAbsoluteUrl(link) {
  try {
    new URL(link);
  } catch {
    failures.push(`README.md has an invalid absolute link: ${link}`);
  }
}

async function assertLocalTarget(link) {
  const [target] = link.split("#");
  if (!target) {
    return;
  }
  try {
    await access(path.resolve(root, decodeURI(target).replace(/^\/+/, "")));
  } catch {
    failures.push(`README.md has a missing local link target: ${link}`);
  }
}

function objectValue(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}
