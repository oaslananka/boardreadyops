import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

const DOCS_URL = "https://oaslananka.github.io/boardreadyops/";

describe("BoardReadyOps production docs — homepage", () => {
  it("loads the homepage with heading and description", async (context) => {
    const testdriver = TestDriver(context);

    await testdriver.provision.chrome({ url: DOCS_URL });

    const assertResult = await testdriver.assert(
      'The BoardReadyOps documentation homepage is loaded, showing the "BoardReadyOps" heading and the description about it being a release-readiness gate for KiCad hardware repositories',
    );
    expect(assertResult).toBeTruthy();
  });
});
