import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0f0d",
        padding: 80,
      }}
    >
      <svg
        width="88"
        height="88"
        viewBox="0 0 104 104"
        role="img"
        aria-label="BoardReadyOps"
        style={{ marginBottom: 36 }}
      >
        <title>BoardReadyOps</title>
        <rect x="4" y="4" width="96" height="96" rx="20" fill="#0f1713" stroke="#1e2e26" />
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
      <div style={{ fontSize: 56, fontWeight: 700, color: "#f4fff8", textAlign: "center", lineHeight: 1.2 }}>
        Release evidence that leads to a decision.
      </div>
      <div style={{ fontSize: 26, color: "#9fc9ae", marginTop: 24, textAlign: "center" }}>
        BoardReadyOps — release readiness for KiCad hardware
      </div>
    </div>,
    { ...size },
  );
}
