import { describe, expect, it } from "vitest";
import { metadata } from "../../../apps/web/app/layout.js";

describe("root layout metadata", () => {
  it("sets metadataBase for absolute asset URLs", () => {
    expect(metadata.metadataBase?.toString()).toBe("https://boardreadyops.com/");
  });

  it("keeps the existing page title template", () => {
    expect(metadata.title).toEqual({ default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" });
  });

  it("sets Open Graph fields for social sharing", () => {
    expect(metadata.openGraph?.title).toBe("BoardReadyOps — Catch board mistakes before the fab does.");
    expect(metadata.openGraph?.url).toBe("https://boardreadyops.com");
    expect((metadata.openGraph as { type?: string })?.type).toBe("website");
  });

  it("sets a large-image Twitter card", () => {
    expect((metadata.twitter as { card?: string })?.card).toBe("summary_large_image");
  });
});
