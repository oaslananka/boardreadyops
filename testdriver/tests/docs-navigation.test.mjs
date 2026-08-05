import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

const DOCS_URL = "https://oaslananka.github.io/boardreadyops/";

describe("BoardReadyOps production docs — navigation", () => {
  it("navigates from the homepage to the Quickstart page", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: DOCS_URL });

    // Follow the Quickstart link in the left sidebar navigation.
    await testdriver.find("Quickstart link in the left sidebar navigation menu").click();
    await testdriver.wait(2000);

    const assertResult = await testdriver.assert(
      'The Quickstart documentation page is displayed with a "Quickstart" heading',
    );
    expect(assertResult).toBeTruthy();
  });
});
