/**
 * Vitest stub for `next/font/local`. Next.js transforms font-loader imports at
 * compile time; importing them directly in metadata/unit tests isn't supported.
 * This stub preserves only the shape used by app/layout.tsx in those tests.
 */
export type LoadedFont = {
  variable: string;
  className: string;
  style: { fontFamily: string };
};

export default function localFont(options: { variable?: string } = {}): LoadedFont {
  return {
    variable: options.variable ?? "",
    className: "",
    style: { fontFamily: "local-font-test-stub" },
  };
}
