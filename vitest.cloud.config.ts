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
        if (!id.includes("/apps/web/") || !id.endsWith(".tsx")) return;
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
        if (!id.endsWith(".mustache")) return;
        return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  resolve: {
    alias: {
      // Mirrors vitest.config.ts: next/font/google ships empty because Next replaces loader
      // calls at build time, so any module calling one throws without this stub. This config
      // runs the web tests for the cloud coverage gate and needs the same alias.
      "next/font/google": fileURLToPath(new URL("tests/stubs/next-font-google.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/cloud-core/**/*.test.ts",
      "tests/unit/contracts/**/*.test.ts",
      "tests/unit/db/**/*.test.ts",
      "tests/unit/web/**/*.test.ts",
    ],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: PIPELINE_TEST_TIMEOUT_MS,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/cloud",
      reporter: ["text", "lcov"],
      include: [
        "packages/cloud-core/src/**/*.ts",
        "packages/contracts/src/**/*.ts",
        "packages/db/src/**/*.ts",
        "apps/web/lib/**/*.ts",
        "apps/web/app/api/**/*.ts",
      ],
      exclude: ["**/*.d.ts", "**/index.ts"],
      thresholds: {
        lines: 61,
        branches: 48,
        functions: 55,
        statements: 57,
        "apps/web/**": { lines: 70, branches: 62, functions: 63, statements: 66 },
        "packages/cloud-core/src/**": { lines: 83, branches: 77, functions: 77, statements: 83 },
        "packages/contracts/src/**": { lines: 93, branches: 80, functions: 100, statements: 93 },
        "packages/db/src/**": { lines: 41, branches: 29, functions: 41, statements: 38 },
      },
    },
  },
});
