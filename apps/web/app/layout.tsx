import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "../components/theme-provider.js";
import "./globals.css";

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
  description: "Checks whether a hardware board is ready to fabricate, on every pull request.",
  openGraph: {
    title: "BoardReadyOps — Know what stands between your board and production.",
    description:
      "Design, BOM, and manufacturing checks run on every pull request and tell you in one line whether the board is ready to fabricate.",
    url: "https://boardreadyops.com",
    siteName: "BoardReadyOps",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BoardReadyOps — Know what stands between your board and production.",
    description:
      "Design, BOM, and manufacturing checks run on every pull request and tell you in one line whether the board is ready to fabricate.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
