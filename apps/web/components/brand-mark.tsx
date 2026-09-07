export type BrandMarkProps = {
  readonly size?: number;
  readonly className?: string;
  /**
   * Explicit colours for renderers that cannot resolve CSS custom properties — `next/og` (Satori)
   * in `app/icon.tsx` and `app/opengraph-image.tsx`. In the app itself the defaults are correct:
   * the outline follows the surrounding text colour and the accent follows the active theme, so
   * one drawing serves light, dark, docs, and the favicon without a literal hex anywhere.
   */
  readonly accentColor?: string;
  readonly outlineColor?: string;
};

/**
 * The mark is a quad-flat-pack silhouette: a chip body, three pins per side, and a pin-1 dot.
 *
 * It carries no checkmark on purpose. A check is what every status badge in the app already
 * means, and ADR-0016 reserves that vocabulary for status; spending it on the logo would dilute
 * the one signal the product exists to deliver.
 */
export function BrandMarkIcon({
  size = 32,
  className,
  accentColor = "var(--primary, #9e93ff)",
  outlineColor = "currentColor",
}: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 104 104" role="img" aria-label="BoardReadyOps" className={className}>
      <g stroke={accentColor} strokeWidth="7" strokeLinecap="round">
        <line x1="10" y1="38" x2="24" y2="38" />
        <line x1="10" y1="52" x2="24" y2="52" />
        <line x1="10" y1="66" x2="24" y2="66" />
        <line x1="80" y1="38" x2="94" y2="38" />
        <line x1="80" y1="52" x2="94" y2="52" />
        <line x1="80" y1="66" x2="94" y2="66" />
      </g>
      <rect
        x="24"
        y="24"
        width="56"
        height="56"
        rx="8"
        fill={outlineColor}
        fillOpacity="0.08"
        stroke={outlineColor}
        strokeWidth="7"
      />
      <circle cx="38" cy="38" r="6" fill={accentColor} />
    </svg>
  );
}

/** The lockup only sizes and positions the mark; colour comes from the surrounding text. */
export function BrandMarkLockup({ size = 24, className }: Readonly<{ size?: number; className?: string }>) {
  return (
    <span className={className ?? "flex items-center gap-2"}>
      <BrandMarkIcon size={size} />
      <span className="font-display text-base tracking-tight text-foreground">BoardReadyOps</span>
    </span>
  );
}
