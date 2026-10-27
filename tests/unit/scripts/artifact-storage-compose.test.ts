import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type Service = {
  image?: string;
  user?: string;
  environment?: Record<string, string>;
  volumes?: string[];
};
type Compose = { services?: Record<string, Service> };

const compose = yaml.load(readFileSync("deploy/docker-compose.yml", "utf8")) as Compose;
const dockerfile = readFileSync("apps/web/Dockerfile", "utf8");

describe("local artifact storage deployment boundary", () => {
  it("mounts the identical writable artifact volume at the same path for web and worker", () => {
    const web = compose.services?.web;
    const worker = compose.services?.worker;
    expect(web).toBeDefined();
    expect(worker).toBeDefined();
    expect(worker?.image).toBe(web?.image);
    for (const service of [web, worker]) {
      expect(service?.environment?.ARTIFACT_STORAGE_ROOT).toBe("/data/artifacts");
      expect(service?.volumes).toContain("boardreadyops_artifacts:/data/artifacts");
      expect(service?.user).toBeUndefined();
    }
  });

  it("seeds new volume ownership for unprivileged node before changing USER", () => {
    const install = "install -d -o node -g node -m 0700 /data/artifacts";
    const installAt = dockerfile.indexOf(install);
    const runtimeUserAt = dockerfile.indexOf("\nUSER node\n");
    expect(installAt).toBeGreaterThan(-1);
    expect(runtimeUserAt).toBeGreaterThan(installAt);
    const entrypoint = readFileSync("apps/web/docker-entrypoint.sh", "utf8");
    expect(entrypoint).not.toMatch(/\bchown\b|\bchmod\b/);
  });

  it("requires separate operator authorization for existing volume repairs", () => {
    const runbook = readFileSync("docs/deployment/self-hosted.md", "utf8");
    expect(runbook).toContain("Existing named volumes require independent verification");
    expect(runbook).toContain("Stop the rollout");
    expect(runbook).toContain("separate change approval");
    expect(runbook).toContain("worker quiescence");
    expect(runbook).toContain("least-privileged read-only");
  });
});
