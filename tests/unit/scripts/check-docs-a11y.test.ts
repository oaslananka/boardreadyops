import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidateChromeExecutables,
  collectHtmlFiles,
  filterPa11yIssues,
  formatPa11yFailures,
  pa11yOptions,
  runPa11yPageWithRetry,
} from "../../../scripts/check-docs-a11y.mjs";

describe("check-docs-a11y", () => {
  it("collects generated HTML pages in stable order", async () => {
    const siteDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-docs-a11y-"));
    await fs.mkdir(path.join(siteDir, "reports", "html"), { recursive: true });
    await fs.mkdir(path.join(siteDir, "search"), { recursive: true });
    await fs.writeFile(path.join(siteDir, "reports", "html", "index.html"), "<!doctype html><title>HTML</title>");
    await fs.writeFile(path.join(siteDir, "index.html"), "<!doctype html><title>Home</title>");
    await fs.writeFile(path.join(siteDir, "search", "search_index.json"), "{}");

    await expect(collectHtmlFiles(siteDir)).resolves.toEqual([
      path.join(siteDir, "index.html"),
      path.join(siteDir, "reports", "html", "index.html"),
    ]);
  });

  it("formats pa11y failures with page-relative selectors", () => {
    const siteDir = path.join("tmp", "site");
    const page = path.join(siteDir, "reports", "html", "index.html");
    const output = formatPa11yFailures(siteDir, [
      {
        page,
        issues: [
          {
            code: "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail",
            context: "<a>Low contrast</a>",
            message: "This element has insufficient contrast.",
            selector: "main a",
            type: "error",
            typeCode: 1,
          },
        ],
      },
    ]);

    expect(output).toContain("reports/html/index.html");
    expect(output).toContain("main a");
    expect(output).toContain("This element has insufficient contrast.");
    expect(output).toContain("WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail");
  });

  it("filters Material navigation color contrast false positives only", async () => {
    const fakePage = {
      evaluate: async (_fn: unknown, selector: string) => selector === "#nav-label",
    };
    const issues = [
      { code: "color-contrast", selector: "#nav-label" },
      { code: "color-contrast", selector: "main a" },
      { code: "landmark-one-main", selector: "#nav-label" },
    ];

    await expect(filterPa11yIssues(fakePage, issues)).resolves.toEqual([issues[1], issues[2]]);
  });

  it("uses WCAG 2 AA checks with axe and htmlcs runners", () => {
    expect(pa11yOptions).toMatchObject({
      includeNotices: false,
      includeWarnings: false,
      runners: ["axe", "htmlcs"],
      standard: "WCAG2AA",
    });
  });

  it("clears a flaky page on retry and reports a persistent failure", async () => {
    const fakeBrowser = { newPage: async () => ({ close: async () => {} }) };

    let calls = 0;
    const flaky = async () => {
      calls += 1;
      return { issues: calls === 1 ? [{ code: "color-contrast" }] : [] };
    };
    await expect(runPa11yPageWithRetry(flaky, "http://x/", fakeBrowser, 3)).resolves.toEqual([]);
    expect(calls).toBe(2); // stopped retrying once the page was clean

    let attempts = 0;
    const persistent = async () => {
      attempts += 1;
      return { issues: [{ code: "color-contrast" }] };
    };
    const issues = await runPa11yPageWithRetry(persistent, "http://x/", fakeBrowser, 3);
    expect(issues).toHaveLength(1);
    expect(attempts).toBe(3); // exhausted all attempts before failing
  });

  it("recovers from transient browser errors by reopening the browser", async () => {
    const closedPage = { close: async () => undefined };
    const cleanPage = { close: async () => undefined };
    const firstBrowser = { newPage: async () => closedPage };
    const recoveredBrowser = { newPage: async () => cleanPage };
    let calls = 0;
    let recoveries = 0;
    const pa11y = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Connection closed.");
      }
      return { issues: [] };
    };

    const runPa11yPageWithRecovery: (
      checker: typeof pa11y,
      url: string,
      browser: typeof firstBrowser,
      attempts: number,
      recoverBrowser: () => Promise<typeof recoveredBrowser>,
    ) => Promise<Array<{ code?: string }>> = runPa11yPageWithRetry;

    await expect(
      runPa11yPageWithRecovery(pa11y, "http://x/", firstBrowser, 3, async () => {
        recoveries += 1;
        return recoveredBrowser;
      }),
    ).resolves.toEqual([]);
    expect(calls).toBe(2);
    expect(recoveries).toBe(1);
  });

  it("detects standard Windows browser install paths", () => {
    const candidates = candidateChromeExecutables({
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      CHROME_PATH: "D:\\Portable\\chrome.exe",
      LOCALAPPDATA: "C:\\Users\\Admin\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    });

    expect(candidates).toContain("D:\\Portable\\chrome.exe");
    expect(candidates).toContain(path.join("C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"));
    expect(candidates).toContain(
      path.join("C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  });
});
