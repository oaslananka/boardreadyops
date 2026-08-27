import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { defineConfig } from "vitest/config";

const PIPELINE_TEST_TIMEOUT_MS = 15_000;

export default defineConfig({
  plugins: [
    {
      name: "web-tsx-tests",
      enforce: "pre",
      async transform(code, id) {
        const normalizedId = id.replaceAll("\\", "/");
        if (!normalizedId.includes("/apps/web/") || !normalizedId.endsWith(".tsx")) return;
        return await transform(code, {
          loader: "tsx",
          jsx: "automatic",
          format: "esm",
          sourcemap: "inline",
          sourcefile: id,
        });
      },
    },
    {
      name: "raw-mustache",
      transform(code, id) {
        if (!id.endsWith(".mustache")) {
          return;
        }
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null,
        };
      },
    },
  ],
  resolve: {
    alias: {
      // next/font/google ships empty; Next replaces loader calls at build time, so importing
      // any module that calls one would throw here without a stub.
      // fileURLToPath, not pathname: stripping a leading slash by hand only produces a
      // valid path on Windows and breaks the alias everywhere else.
      "next/font/google": fileURLToPath(new URL("tests/stubs/next-font-google.ts", import.meta.url)),
      "next/navigation": fileURLToPath(new URL("apps/web/node_modules/next/navigation.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: PIPELINE_TEST_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/{core,rules,bom,pinmap,report,kicad,notifiers}/**/*.ts", "src/action/inputs.ts"],
      exclude: [
        "src/report/templates/**",
        "src/**/types.ts",
        "src/core/context.ts",
        "src/core/result.ts",
        "src/core/errors.ts",
      ],
      thresholds: {
        lines: 97,
        branches: 91,
        functions: 98,
        statements: 97,
        "src/core/**": {
          lines: 99,
          branches: 94,
          functions: 99,
          statements: 99,
        },
        "src/rules/**": {
          lines: 97,
          branches: 91,
          functions: 96,
          statements: 97,
        },
        "src/bom/**": {
          lines: 97,
          branches: 93,
          functions: 97,
          statements: 97,
        },
        "src/pinmap/**": {
          lines: 97,
          branches: 93,
          functions: 97,
          statements: 97,
        },
        "src/report/**": {
          lines: 97,
          branches: 93,
          functions: 97,
          statements: 97,
        },
        "src/kicad/**": {
          lines: 95,
          branches: 85,
          functions: 95,
          statements: 95,
        },
        "src/notifiers/**": {
          lines: 95,
          branches: 85,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
