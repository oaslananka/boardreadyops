import { expect, type Page, test } from "@playwright/test";

async function yamlRowTops(page: Page): Promise<number[]> {
  const preview = page
    .locator("figure")
    .filter({ has: page.getByRole("button", { name: "Copy YAML" }) })
    .first();
  const rows = preview.locator("pre code > span");
  await expect(rows).toHaveCount(41);
  return rows.evaluateAll((elements) =>
    elements.map((element) => Math.round((element as HTMLElement).getBoundingClientRect().top)),
  );
}

function expectRowsStrictlyIncrease(tops: number[]): void {
  for (let index = 1; index < tops.length; index += 1) {
    expect(tops[index], `row ${index + 1} should render below row ${index}`).toBeGreaterThan(
      tops[index - 1] ?? -Infinity,
    );
  }
}

test("@smoke keeps production YAML rows vertically ordered after switching from open-source", async ({ page }) => {
  await page.goto("/setup?preset=open-source");
  await page.getByRole("link", { name: "Preview Production release" }).click();
  await expect(page).toHaveURL(/preset=production/);

  expectRowsStrictlyIncrease(await yamlRowTops(page));
});

test("@smoke keeps contract-design YAML rows vertically ordered after switching from prototype", async ({ page }) => {
  await page.goto("/setup?preset=prototype");
  await page.getByRole("link", { name: "Preview Contract design handoff" }).click();
  await expect(page).toHaveURL(/preset=contract-design/);

  expectRowsStrictlyIncrease(await yamlRowTops(page));
});
