import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type Service = { logging?: { driver?: string; options?: Record<string, string> } };
type Compose = { services?: Record<string, Service> };

describe("self-hosted Compose log retention", () => {
  it("bounds JSON logs on every runtime and migration service", () => {
    const config = yaml.load(readFileSync("deploy/docker-compose.yml", "utf8")) as Compose;
    expect(Object.keys(config.services ?? {}).length).toBeGreaterThan(0);
    for (const [name, service] of Object.entries(config.services ?? {})) {
      expect(service.logging, name).toEqual({
        driver: "json-file",
        options: { "max-size": "10m", "max-file": "3" },
      });
    }
  });

  it("documents that log settings need a separately authorized container recreation", () => {
    const runbook = readFileSync("docs/deployment/self-hosted.md", "utf8");
    expect(runbook).toContain("newly created/recreated containers");
    expect(runbook).toContain("does not rotate existing production logs");
    expect(runbook).toContain("does not modify the host's Docker daemon");
  });
});
