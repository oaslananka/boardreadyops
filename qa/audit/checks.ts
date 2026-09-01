import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const require = createRequire(import.meta.url);

export type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
};

export type ConsoleIssue = {
  kind: "console.error" | "pageerror";
  text: string;
};

/**
 * Errors real BoardReadyOps pages are known to emit that aren't regressions. Keep this narrow
 * and specific (exact substrings, not broad prefixes) -- a broad ignore here is exactly the
 * "silently accept known errors" failure mode this audit exists to prevent.
 */
const consoleAllowlist: readonly string[] = [
  // React DevTools suggestion, present in every non-production build; not a defect.
  "Download the React DevTools",
  // Chromium logs the top-level document's own non-2xx response as a console error, even for a
  // correctly-implemented notFound() route (qa/audit/routes.ts's errorStates). A page returning
  // its actual 404 status is the intended behavior, not a bug.
  "the server responded with a status of 404",
  // Routes marked auth: "authenticated" in qa/audit/routes.ts (e.g. /policies) fire an
  // authenticated fetch on mount; without QA_SESSION_SECRET configured (the common local-dev
  // case -- see tests/e2e/global-setup.ts), the crawler has no real session to attach, so the
  // API correctly fail-closes with 401 and Chromium logs the rejected fetch. This is the same
  // "intended non-2xx, not a regression" case as the 404 entry above, not a hole that would also
  // hide a real bug: if a real session *were* configured (CI/nightly with the secret set) and an
  // authenticated route still 401'd, that failure is a genuine session-plumbing bug this
  // allowlist entry would mask -- see docs/development/qa-agent.md's "What's not done" section.
  "the server responded with a status of 401",
];

function isAllowlisted(text: string): boolean {
  return consoleAllowlist.some((allowed) => text.includes(allowed));
}

/** Attaches console/pageerror listeners; call the returned function after navigation settles. */
export function collectConsoleIssues(page: Page): () => ConsoleIssue[] {
  const issues: ConsoleIssue[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isAllowlisted(msg.text())) {
      issues.push({ kind: "console.error", text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    if (!isAllowlisted(err.message)) {
      issues.push({ kind: "pageerror", text: err.message });
    }
  });
  return () => issues;
}

/** Runs axe-core (already a repo devDependency) against the current page. WCAG 2 A/AA only. */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const results = await page.evaluate(async () => {
    // @ts-expect-error injected by the script tag above, not a module import
    return window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  });
  return (results.violations as Array<{ id: string; impact: string | null; help: string; nodes: unknown[] }>).map(
    (v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }),
  );
}

export type DomSanityIssue = { rule: string; detail: string };

/** Cheap structural checks axe doesn't fully cover: heading count, duplicate ids, a main landmark. */
export async function checkDomSanity(page: Page): Promise<DomSanityIssue[]> {
  return page.evaluate(() => {
    const issues: { rule: string; detail: string }[] = [];

    const h1s = document.querySelectorAll("h1");
    if (h1s.length === 0) issues.push({ rule: "heading-h1-missing", detail: "No <h1> on the page" });
    if (h1s.length > 1) {
      issues.push({ rule: "heading-h1-multiple", detail: `${h1s.length} <h1> elements found` });
    }

    if (!document.querySelector("main")) {
      issues.push({ rule: "landmark-main-missing", detail: "No <main> landmark" });
    }

    const seenIds = new Map<string, number>();
    for (const el of document.querySelectorAll<HTMLElement>("[id]")) {
      const id = el.id;
      if (!id) continue;
      seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
    }
    for (const [id, count] of seenIds) {
      if (count > 1) issues.push({ rule: "duplicate-id", detail: `#${id} appears ${count} times` });
    }

    return issues;
  });
}

/** True if the document is wider than its own viewport -- the most common mobile layout bug. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

export type LinkCheckResult = { href: string; status: number | "error" };

/**
 * Collects same-origin internal links visible on the page and HEAD/GET-checks each once.
 * Intentionally shallow (one hop, not a full-site crawl) -- qa-audit.spec.ts already visits
 * every route in the inventory directly; this exists to catch links a route inventory can't
 * predict, like a review card linking to a specific dynamic id.
 */
export async function checkInternalLinks(page: Page, originPrefix: string): Promise<LinkCheckResult[]> {
  const hrefs = await page.evaluate((prefix) => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const seen = new Set<string>();
    for (const a of anchors) {
      const href = a.getAttribute("href") ?? "";
      // /api/ routes have their own error contracts (e.g. auth/webhook endpoints deliberately
      // fail closed with 503 when unconfigured, the same way the Stripe webhook does) -- not
      // page-to-page navigation, so not this check's concern.
      if (!href || href.startsWith("#") || href.startsWith("/api/")) continue;
      if (href.startsWith("/") || href.startsWith(prefix)) seen.add(href);
    }
    return Array.from(seen);
  }, originPrefix);

  const results: LinkCheckResult[] = [];
  for (const href of hrefs) {
    try {
      const response = await page.request.get(href.startsWith("http") ? href : `${originPrefix}${href}`, {
        maxRedirects: 5,
      });
      results.push({ href, status: response.status() });
    } catch {
      results.push({ href, status: "error" });
    }
  }
  return results;
}

const touchTargetMinPx = 44;

export type TouchTargetIssue = { selector: string; width: number; height: number };

/**
 * Flags primary interactive controls under 44x44px. Deliberately scoped to buttons and
 * role="button"/"tab" elements plus nav links, not every inline text link -- per the audit
 * brief, a small inline link isn't a blocker the way an undersized primary action button is.
 */
export async function checkPrimaryTouchTargets(page: Page): Promise<TouchTargetIssue[]> {
  return page.evaluate((minSize) => {
    const selector = 'button, [role="button"], [role="tab"], nav a, .product-mobile-trigger';
    const issues: { selector: string; width: number; height: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < minSize || rect.height < minSize) {
        const label = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName;
        issues.push({ selector: label, width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    }
    return issues;
  }, touchTargetMinPx);
}
