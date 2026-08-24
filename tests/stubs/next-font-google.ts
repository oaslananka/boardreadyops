/**
 * Test stub for `next/font/google`.
 *
 * The real module ships empty: Next.js replaces these loader calls at build time, so calling
 * one outside the compiler throws. Any test that imports a module calling a font loader at
 * module scope needs this stub, which is wired in through a vitest alias.
 */
export type LoadedFont = {
  variable: string;
  className: string;
  style: { fontFamily: string };
};

function loader(options: { variable?: string } = {}): LoadedFont {
  return {
    variable: options.variable ?? "",
    className: "",
    style: { fontFamily: "stub" },
  };
}

export const Inter = loader;
export const JetBrains_Mono = loader;
export const Newsreader = loader;
