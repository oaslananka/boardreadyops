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
  description: "Checks whether a KiCad board is ready to fabricate, on every pull request.",
  openGraph: {
    title: "BoardReadyOps — Catch board mistakes before the fab does.",
    description:
      "KiCad's checks run on every pull request and tell you in one line whether the board is ready to fabricate.",
    url: "https://boardreadyops.com",
    siteName: "BoardReadyOps",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BoardReadyOps — Catch board mistakes before the fab does.",
    description:
      "KiCad's checks run on every pull request and tell you in one line whether the board is ready to fabricate.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before the first paint so a reader who chose a theme never sees the other one
            flash first. <html> carries the page background, so the attribute has to land here
            rather than once the body renders. Readers who never chose are left alone, and the
            stylesheet answers their system preference instead. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a literal with no interpolation, and it has to run before paint.
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("boardreadyops-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
