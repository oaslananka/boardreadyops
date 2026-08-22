import { describe, expect, it } from "vitest";
import { metadata } from "../../../apps/web/app/layout.js";

describe("root layout metadata", () => {
  it("keeps the existing page title template", () => {
    expect(metadata.title).toEqual({ default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" });
  });

  it("sets Open Graph fields for social sharing", () => {
    expect(metadata.openGraph?.title).toBe("BoardReadyOps — Release evidence that leads to a decision.");
    expect(metadata.openGraph?.url).toBe("https://boardreadyops.com");
    expect(metadata.openGraph?.type).toBe("website");
  });

  it("sets a large-image Twitter card", () => {
    expect(metadata.twitter?.card).toBe("summary_large_image");
  });
});
