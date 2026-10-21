import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "../components/theme-provider.js";
import "./globals.css";

// Pinned OFL-licensed WOFF2 assets eliminate remote Google Fonts requests during builds.
// The previous Inter 400/500/600/700 and JetBrains Mono 400/500/700 weights
// remain within the variable font ranges; CSS variable names stay unchanged.
const body = localFont({
  src: "./fonts/inter-latin-variable-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-ui-loaded",
  display: "swap",
});

const mono = localFont({
  src: "./fonts/jetbrains-mono-latin-variable-normal.woff2",
  weight: "100 800",
  style: "normal",
  variable: "--font-mono-loaded",
  display: "swap",
});

/** Reserved for page titles and the wordmark — the one editorial note in an otherwise neutral scale. */
const display = localFont({
  src: "./fonts/instrument-serif-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-display-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://boardreadyops.com"),
  title: { default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" },
  description: "Checks whether a hardware board is ready to fabricate, on every pull request.",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
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
    // `dark` is on <html> deliberately: it is the SSR default matching `defaultTheme="dark"`, and
    // it is what stops a light flash before the next-themes bootstrap script runs. next-themes
    // replaces it on the client when the stored preference differs.
    <html lang="en" className={`dark ${body.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey="boardreadyops.theme"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
