import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/cloud-deploy-topology-preflight.sh");
const web = "boardreadyops-web-runtime:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const worker = "boardreadyops-web-runtime:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const target = "boardreadyops-cloud";

function check(
  records: readonly [string, string, string, string][],
  mode: "0" | "1" = "0",
  failDocker?: "ps" | "inspect",
) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bro-topology-preflight-"));
  const mock = path.join(scratch, "docker");
  fs.writeFileSync(
    mock,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "$1" = "$MOCK_DOCKER_FAIL" ]; then exit 4; fi',
      'case "$1" in',
      '  ps) printf "%s\\n" "$MOCK_CONTAINERS" | awk -F "|" \'NF>1 {print $1}\' ;;',
      '  inspect) printf "%s\\n" "$MOCK_CONTAINERS" | awk -F "|" -v id="$2" \'$1==id {print $2 "|" $3 "|" $4;found=1} END{if(!found)exit 1}\' ;;',
      '  *) echo "unexpected docker operation" >&2; exit 2 ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  try {
    return spawnSync("bash", [script, target, mode], {
      env: {
        ...process.env,
        PATH: scratch + path.delimiter + process.env.PATH,
        MOCK_CONTAINERS: records.map((record) => record.join("|")).join("\n"),
        MOCK_DOCKER_FAIL: failDocker ?? "",
      },
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

describe("cloud-deploy early runtime topology guard", () => {
  const healthy = [
    ["web-1", web, target, "web"],
    ["worker-1", worker, target, "worker"],
  ] as const;

  it("accepts exactly one commissioned web and worker without mutating Docker", () => {
    const result = check([...healthy, ["other", "redis:8-alpine", "another-app", "worker"]]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("commissioned runtime owner verified");
  });

  it("rejects a separately managed live worker even when a healthy commissioned stack exists", () => {
    const result = check([...healthy, ["foreign-worker", worker, "coolify-project", "worker"]]);
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("different container owner");
  });

  it("rejects a foreign web service, an unlabeled runtime, and an unexpected commissioned process", () => {
    for (const record of [
      ["foreign-web", web, "coolify-project", "web"],
      ["orphan", web, "<no value>", "<no value>"],
      ["migrating", web, target, "migrate"],
    ]) {
      const result = check([...healthy, record]);
      expect(result.status).toBe(78);
    }
  });

  it("rejects absent or duplicate commissioned web/worker services", () => {
    for (const records of [
      [],
      [healthy[0]],
      [healthy[1]],
      [...healthy, ["duplicate-worker", worker, target, "worker"]],
      [...healthy, ["duplicate-web", web, target, "web"]],
    ]) {
      expect(check(records).status).toBe(78);
    }
  });

  it("permits only a stopped worker in pre-quiesced mode and still blocks foreign workers", () => {
    expect(check([healthy[0]], "1").status).toBe(0);
    expect(check([...healthy], "1").status).toBe(78);
    expect(check([healthy[0], ["foreign", worker, "coolify-project", "worker"]], "1").status).toBe(78);
  });

  it("fails closed when Docker inventory or container inspect fails", () => {
    expect(check(healthy, "0", "ps").status).toBe(78);
    expect(check(healthy, "0", "inspect").status).toBe(78);
  });
});
