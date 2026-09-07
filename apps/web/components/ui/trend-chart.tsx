import { cn } from "../../lib/utils.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js";

export type TrendPoint = {
  /** Axis label. Kept short — long labels are thinned rather than rotated. */
  readonly label: string;
  readonly value: number;
  /** Optional longer label for the per-bar tooltip and the data table. */
  readonly title?: string;
};

/**
 * A single-series bar chart, rendered on the server as inline SVG.
 *
 * No charting library: the data is one series of periodic counts, which is about sixty lines of
 * SVG, and a library would add a client-only dependency plus a knip entry plus a NOTICE
 * regeneration to draw it — and would still need the accessible fallbacks hand-written.
 *
 * One series means no legend (the heading names it) and one hue, `--primary`. Every bar carries a
 * native SVG `<title>`, so hovering reports its value without any JavaScript, and the whole
 * figure is paired with a real table carrying the same numbers — which is what makes it readable
 * for a screen reader, in forced-colors mode, and by anything parsing the page.
 */
export function TrendChart({
  points,
  caption,
  valueLabel,
  periodLabel = "Period",
  formatValue = (value: number) => String(value),
  className,
}: Readonly<{
  points: readonly TrendPoint[];
  /** Describes the whole figure to assistive tech and titles the data table. */
  caption: string;
  valueLabel: string;
  periodLabel?: string;
  formatValue?: (value: number) => string;
  className?: string;
}>) {
  if (points.length === 0) return null;

  const width = 720;
  const height = 200;
  const padding = { top: 12, right: 8, bottom: 28, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(...points.map((point) => point.value), 1);
  const step = plotWidth / points.length;
  // A 2px gap between fills, and bars never wider than the eye needs.
  const barWidth = Math.max(4, Math.min(48, step - 2));
  // Three gridlines including the baseline: enough to read a magnitude, quiet enough to recede.
  const ticks = [0, Math.round(max / 2), max].filter((tick, index, all) => all.indexOf(tick) === index);
  // Thin axis labels rather than rotating them, so nothing collides at narrow widths.
  const labelEvery = Math.ceil(points.length / 12);

  return (
    <figure className={cn("m-0 flex flex-col gap-3", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${caption}. ${points.length} periods, highest ${formatValue(max)}.`}
        preserveAspectRatio="none"
      >
        <title>{caption}</title>
        <g className="text-border-strong">
          {ticks.map((tick) => {
            const y = padding.top + plotHeight - (tick / max) * plotHeight;
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {formatValue(tick)}
                </text>
              </g>
            );
          })}
        </g>

        <g className="fill-primary">
          {points.map((point, index) => {
            const barHeight = max === 0 ? 0 : (point.value / max) * plotHeight;
            const x = padding.left + index * step + (step - barWidth) / 2;
            const y = padding.top + plotHeight - barHeight;
            return (
              <rect
                key={point.label}
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, point.value > 0 ? 2 : 0)}
                // Rounded data-end only; the baseline end stays square against the axis.
                rx="2"
              >
                <title>{`${point.title ?? point.label}: ${formatValue(point.value)} ${valueLabel}`}</title>
              </rect>
            );
          })}
        </g>

        <g>
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.label}
                x={padding.left + index * step + step / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {point.label}
              </text>
            ) : null,
          )}
        </g>
      </svg>

      <details className="text-sm">
        <summary className="cursor-pointer text-meta text-muted-foreground hover:text-foreground">Show data</summary>
        <div className="mt-2">
          <Table scrollLabel={caption}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">{periodLabel}</TableHead>
                <TableHead scope="col" className="text-right">
                  {valueLabel}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((point) => (
                <TableRow key={point.label}>
                  <TableCell asChild>
                    <th scope="row" className="text-left font-medium">
                      {point.title ?? point.label}
                    </th>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatValue(point.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </figure>
  );
}
