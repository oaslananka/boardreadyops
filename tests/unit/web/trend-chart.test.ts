import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrendChart, type TrendPoint } from "../../../apps/web/components/ui/trend-chart.js";

const points: TrendPoint[] = [
  { label: "01-05", title: "Week of 2026-01-05", value: 3 },
  { label: "01-12", title: "Week of 2026-01-12", value: 8 },
  { label: "01-19", title: "Week of 2026-01-19", value: 0 },
];

function render(overrides: Partial<Parameters<typeof TrendChart>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TrendChart, {
      points,
      caption: "Decision-ready reviews per week",
      valueLabel: "reviews",
      periodLabel: "Week starting",
      ...overrides,
    }),
  );
}

describe("TrendChart", () => {
  it("renders nothing rather than an empty axis when there is no data", () => {
    expect(render({ points: [] })).toBe("");
  });

  it("describes the whole figure to assistive tech", () => {
    const markup = render();
    expect(markup).toContain('role="img"');
    expect(markup).toContain("aria-label=");
    expect(markup).toContain("<title>Decision-ready reviews per week</title>");
  });

  it("carries every value in a real table, not only in the drawing", () => {
    const markup = render();
    expect(markup).toContain("<table");
    for (const point of points) {
      expect(markup).toContain(point.title);
      expect(markup).toContain(`>${point.value}<`);
    }
  });

  it("gives each bar a native tooltip so a value is readable without JavaScript", () => {
    expect(render()).toContain("Week of 2026-01-12: 8 reviews");
  });

  it("draws one bar per point and none for a zero week", () => {
    const markup = render();
    // Three points, but the zero week has no visible bar height to draw.
    expect(markup.match(/<rect/gu)).toHaveLength(points.length);
    expect(markup).toContain('height="0"');
  });

  it("scales bars to the largest value rather than to a fixed ceiling", () => {
    const tall = render({
      points: [
        { label: "a", value: 1 },
        { label: "b", value: 2 },
      ],
    });
    // The tallest bar spans the full plot height whatever the absolute numbers are.
    expect(tall).toContain('height="160"');
  });

  it("uses the single accent hue and recessive axis ink, never a status colour", () => {
    const markup = render();
    expect(markup).toContain("fill-primary");
    expect(markup).toContain("fill-muted-foreground");
    expect(markup).not.toMatch(/fill-(danger|success|warning)/u);
  });
});
