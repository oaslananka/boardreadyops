import { describe, expect, it } from "vitest";
import { BrandMarkIcon, BrandMarkLockup } from "../../../apps/web/components/brand-mark.js";

describe("BrandMarkIcon", () => {
  it("renders an SVG sized by the size prop", () => {
    const element = BrandMarkIcon({ size: 48 });
    expect(element.type).toBe("svg");
    expect(element.props.width).toBe(48);
    expect(element.props.height).toBe(48);
    expect(element.props.viewBox).toBe("0 0 104 104");
  });

  it("defaults to size 32 when no size is given", () => {
    const element = BrandMarkIcon({});
    expect(element.props.width).toBe(32);
  });
});

describe("BrandMarkLockup", () => {
  it("renders the icon at the requested size next to the BoardReadyOps wordmark", () => {
    const element = BrandMarkLockup({ size: 24 });
    const children = element.props.children as [unknown, { props: { children: string } }];
    const [icon, wordmark] = children;
    expect((icon as { type: unknown }).type).toBe(BrandMarkIcon);
    expect((icon as { props: { size: number } }).props.size).toBe(24);
    expect(wordmark.props.children).toBe("BoardReadyOps");
    expect((wordmark as { props: { className?: string } }).props.className).toBe("text-sm font-bold text-foreground");
  });

  it("defaults to size 24 when no size is given", () => {
    const element = BrandMarkLockup({});
    const [icon] = element.props.children as [{ props: { size: number } }];
    expect(icon.props.size).toBe(24);
  });
});
