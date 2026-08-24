import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./styles.css";

// Self-hosted at build time, so no request leaves the reader's browser to a font host.
const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
  variable: "--font-display-loaded",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui-loaded",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono-loaded",
  display: "swap",
});

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
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
