import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://boardreadyops.com"),
  title: { default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" },
  description: "Accessible release investigation for KiCad hardware projects.",
  openGraph: {
    title: "BoardReadyOps — Release evidence that leads to a decision.",
    description:
      "Automated DFM/DFA checks on every pull request, a traceable evidence chain, and a single go/no-go call — before it ships to manufacturing.",
    url: "https://boardreadyops.com",
    siteName: "BoardReadyOps",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BoardReadyOps — Release evidence that leads to a decision.",
    description:
      "Automated DFM/DFA checks on every pull request, a traceable evidence chain, and a single go/no-go call — before it ships to manufacturing.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
