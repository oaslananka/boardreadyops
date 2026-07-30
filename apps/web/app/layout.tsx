import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: { default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" },
  description: "Accessible release investigation for KiCad hardware projects.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
