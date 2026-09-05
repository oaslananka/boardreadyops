import { ImageResponse } from "next/og";
import { BrandMarkIcon } from "../components/brand-mark";

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
        background: "#0d1117",
        padding: 80,
      }}
    >
      <div style={{ marginBottom: 36, display: "flex" }}>
        <BrandMarkIcon size={88} />
      </div>
      <div style={{ fontSize: 56, fontWeight: 700, color: "#ece5d3", textAlign: "center", lineHeight: 1.2 }}>
        Release evidence that leads to a decision.
      </div>
      <div style={{ fontSize: 26, color: "#58a6ff", marginTop: 24, textAlign: "center" }}>
        BoardReadyOps — release readiness for hardware teams
      </div>
    </div>,
    { ...size },
  );
}
