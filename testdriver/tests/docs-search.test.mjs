import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

const DOCS_URL = "https://oaslananka.github.io/boardreadyops/";

describe("BoardReadyOps production docs — search", () => {
  it("returns relevant results when searching the docs", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: DOCS_URL });

    // Open the search box and query for a known docs topic.
    await testdriver
      .find('Search box with magnifying glass and "Search" placeholder in the top header bar')
      .click();
    await testdriver.type("vendor profiles");
    await testdriver.wait(2000);

    const assertResult = await testdriver.assert(
      'A search results dropdown is showing matching documents for "vendor profiles", including a result titled "Vendor Profiles"',
    );
    expect(assertResult).toBeTruthy();
  });
});
