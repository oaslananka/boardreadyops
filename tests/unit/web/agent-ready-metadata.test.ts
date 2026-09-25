import { describe, expect, it } from "vitest";
import { metadata } from "../../../apps/web/app/layout.js";

describe("Agent Ready metadata", () => {
  it("allows full Google snippet and image previews", () => {
    expect(metadata.robots).toMatchObject({
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    });
  });
});
