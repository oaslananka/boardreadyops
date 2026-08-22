import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <svg width="64" height="64" viewBox="0 0 104 104" role="img" aria-label="BoardReadyOps">
        <title>BoardReadyOps</title>
        <rect x="4" y="4" width="96" height="96" rx="20" fill="#0f1713" stroke="#1e2e26" />
        <g stroke="#3fe08a" strokeWidth="3" strokeLinecap="round">
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
        <rect x="30" y="30" width="44" height="44" rx="4" fill="#0c1f16" stroke="#3fe08a" strokeWidth="2.25" />
        <circle cx="36" cy="36" r="2.2" fill="#3fe08a" />
        <path
          d="M40 52 L47 59 L64 42"
          stroke="#f4fff8"
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    { ...size },
  );
}
