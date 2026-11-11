import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type Service = {
  build?: { context?: string; dockerfile?: string };
  command?: string[];
  env_file?: string[];
  environment?: Record<string, string>;
  volumes?: Array<string | { type?: string; source?: string; target?: string; read_only?: boolean }>;
  networks?: string[];
  ports?: string[];
  expose?: string[];
  healthcheck?: { test?: string[] };
  restart?: string;
  stop_grace_period?: string;
};
type Compose = {
  services?: Record<string, Service>;
  networks?: Record<string, { external?: boolean; name?: string }>;
  volumes?: Record<string, { external?: boolean; name?: string }>;
};

const source = readFileSync(new URL("../../../deploy/docker-compose.worker.yml", import.meta.url), "utf8");
const config = yaml.load(source) as Compose;
const interpolation = (name: string): string => ["$", "{", name, "}"].join("");

describe("production worker-only Coolify cutover contract", () => {
  it("manages only the worker, not web, tunnel, migration or stateful services", () => {
    expect(Object.keys(config.services ?? {})).toEqual(["worker"]);
    const worker = config.services?.worker;
    expect(worker?.build).toEqual({
      context: ".",
      dockerfile: "apps/web/Dockerfile",
      args: {
        BUILD_DATE: interpolation("BOARDREADYOPS_BUILD_DATE:-unknown"),
        VCS_REF: interpolation("SOURCE_COMMIT:?An immutable Git source commit is required"),
        VERSION: interpolation("BOARDREADYOPS_VERSION:-dev"),
      },
    });
    expect(worker?.command).toEqual(["node", "worker.mjs"]);
    expect(worker?.ports).toBeUndefined();
    expect(worker?.expose).toEqual(["3001"]);
    expect(worker?.restart).toBe("unless-stopped");
    expect(worker?.stop_grace_period).toBe("5m");
    expect(source).toContain("SOURCE_COMMIT:?");
  });

  it("uses only verified existing backend network, artifacts and policy mount", () => {
    expect(config.networks?.backend).toEqual({
      external: true,
      name: interpolation("BOARDREADYOPS_WORKER_BACKEND_NETWORK"),
    });
    expect(config.volumes?.boardreadyops_artifacts).toEqual({
      external: true,
      name: interpolation("BOARDREADYOPS_ARTIFACT_VOLUME"),
    });
    const worker = config.services?.worker;
    expect(worker?.networks).toEqual(["backend"]);
    expect(worker?.env_file).toEqual([".env"]);
    expect(worker?.environment?.DATABASE_URL).toContain("DATABASE_URL:?");
    expect(worker?.environment?.BOARDREADYOPS_RUNNER_MODE).toBe("github-actions");
    expect(worker?.environment?.BOARDREADYOPS_WORKER_BACKEND_NETWORK).toContain("NETWORK:?");
    expect(worker?.volumes).toContain("boardreadyops_artifacts:/data/artifacts");
    expect(worker?.volumes).toContainEqual({
      type: "bind",
      source: interpolation("BOARDREADYOPS_RELEASE_POLICY_HOST_FILE"),
      target: "/run/policies/repositories",
      read_only: true,
    });
  });

  it("checks real worker readiness on 3001 rather than the image's web-only 3000 check", () => {
    const worker = config.services?.worker;
    const healthcheck = JSON.stringify(worker?.healthcheck?.test);
    expect(healthcheck).toContain("3001/health/ready");
    expect(healthcheck).toContain("runnerConfigurationValid");
    expect(healthcheck).toContain("databaseReady");
    expect(source).not.toMatch(/^\s+ports\s*:/mu);
  });
});
