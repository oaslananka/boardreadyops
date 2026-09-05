export type BrandMarkProps = {
  readonly size?: number;
  readonly className?: string;
};

export function BrandMarkIcon({ size = 32, className }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 104 104" role="img" aria-label="BoardReadyOps" className={className}>
      <rect x="4" y="4" width="96" height="96" rx="20" fill="#0d1117" stroke="#232a38" />
      <g stroke="var(--color-primary, #58a6ff)" strokeWidth="3" strokeLinecap="round">
        <line x1="36" y1="22" x2="36" y2="30" />
        <line x1="46" y1="22" x2="46" y2="30" />
        <line x1="58" y1="22" x2="58" y2="30" />
        <line x1="68" y1="22" x2="68" y2="30" />
        <line x1="36" y1="74" x2="36" y2="82" />
        <line x1="46" y1="74" x2="46" y2="82" />
        <line x1="58" y1="74" x2="58" y2="82" />
        <line x1="68" y1="74" x2="68" y2="82" />
        <line x1="22" y1="36" x2="30" y2="36" />
        <line x1="22" y1="46" x2="30" y2="46" />
        <line x1="22" y1="58" x2="30" y2="58" />
        <line x1="22" y1="68" x2="30" y2="68" />
        <line x1="74" y1="36" x2="82" y2="36" />
        <line x1="74" y1="46" x2="82" y2="46" />
        <line x1="74" y1="58" x2="82" y2="58" />
        <line x1="74" y1="68" x2="82" y2="68" />
      </g>
      <rect
        x="30"
        y="30"
        width="44"
        height="44"
        rx="4"
        fill="#080b10"
        stroke="var(--color-primary, #58a6ff)"
        strokeWidth="2.25"
      />
      <circle cx="36" cy="36" r="2.2" fill="var(--color-primary, #58a6ff)" />
      <path
        d="M40 52 L47 59 L64 42"
        stroke="#ece5d3"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandMarkLockup({ size = 24, className }: BrandMarkProps) {
  return (
    <span className={className ?? "flex items-center gap-2"}>
      <BrandMarkIcon size={size} />
      <span className="text-sm font-bold text-foreground">BoardReadyOps</span>
    </span>
  );
}
