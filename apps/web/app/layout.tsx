import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "BoardReadyOps Cloud",
  description: "Self-hosted release readiness dashboard for KiCad hardware projects.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
