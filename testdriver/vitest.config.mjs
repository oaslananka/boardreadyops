import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Load TestDriver credentials (TD_API_KEY) from testdriver/.env, then repo root .env.
config();
config({ path: "../.env" });

export default defineConfig({
  test: {
    testTimeout: 900000,
    hookTimeout: 900000,
  },
});
