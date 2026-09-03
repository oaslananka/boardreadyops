import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAuthenticatedUnlighthouseConfig } from "./scripts/unlighthouse-authenticated.mjs";

const manifestPath = resolve(".unlighthouse/authenticated-routes.json");
const session = process.env.BROPS_SESSION?.trim();

if (!session) {
  throw new Error("BROPS_SESSION is required");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  site: string;
  routes: string[];
};

export default buildAuthenticatedUnlighthouseConfig({
  site: manifest.site,
  session,
  routes: manifest.routes,
  headful: process.env.BROPS_UNLIGHTHOUSE_HEADFUL === "1",
});
