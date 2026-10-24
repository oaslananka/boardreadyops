import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const retentionScript = path.resolve("scripts/cloud-runtime-image-retention.sh");
const workdirs: string[] = [];
const active = `sha256:${"a".repeat(64)}`;
const currentTag = `boardreadyops-web-runtime:${"a".repeat(40)}`;
const priorTag = `boardreadyops-web-runtime:${"b".repeat(40)}`;
const obsoleteTag = `boardreadyops-web-runtime:${"c".repeat(40)}`;

const mockDocker = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
const active = 'sha256:'+'a'.repeat(64);
const pinned = process.env.TEST_SAME_PIN === '1' ? active : 'sha256:'+'b'.repeat(64);
const obsolete = 'sha256:'+'c'.repeat(64);
const stopped = 'sha256:'+'d'.repeat(64);
const currentTag = 'boardreadyops-web-runtime:'+'a'.repeat(40);
const priorTag = 'boardreadyops-web-runtime:'+'b'.repeat(40);
const obsoleteTag = 'boardreadyops-web-runtime:'+'c'.repeat(40);
const out = text => { process.stdout.write(text+'\n'); };
const exit = code => process.exit(code);
if (a[0] === 'ps') {
  if (a.includes('-aq')) { if (process.env.TEST_PS_FAIL === '1') exit(1); out('webcid\nworkercid\nstoppedcid'); exit(0); }
  if (a.some(x => x.includes('service=web'))) { out('webcid'); exit(0); }
  if (a.some(x => x.includes('service=worker'))) { out('workercid'); exit(0); }
}
if (a[0] === 'inspect') {
  const fmt = a[a.indexOf('--format')+1];
  if (a[1] === 'webcid' && a[2] === 'workercid') { out([active,active,stopped].join('\n')); exit(0); }
  if (a[1] === 'webcid' || a[1] === 'workercid') {
    if (fmt.includes('.Config.Image')) { out(currentTag); exit(0); }
    if (fmt.includes('.State.Health')) { out(process.env.TEST_BAD_HEALTH === '1' ? 'unhealthy' : 'healthy'); exit(0); }
    if (fmt.includes('.Image')) { out(a[1] === 'workercid' && process.env.TEST_MISMATCH === '1' ? obsolete : active); exit(0); }
  }
}
if (a[0] === 'image' && a[1] === 'inspect') {
  if (a[2] === 'boardreadyops-rollback-safety:verified' && process.env.TEST_NO_PIN === '1') exit(1);
  const fmt = a[a.indexOf('--format')+1];
  let id = a[2] === 'boardreadyops-rollback-safety:verified' ? pinned :
    [currentTag, active].includes(a[2]) ? active :
    [priorTag, 'sha256:'+'b'.repeat(64)].includes(a[2]) ? pinned :
    [obsoleteTag, 'boardreadyops-rollback-safety:pre-old'].includes(a[2]) ? obsolete :
    a[2] === 'boardreadyops-rollback-safety:pre-stopped' ? stopped : null;
  if (!id) exit(1);
  if (fmt.includes('org.opencontainers.image.revision')) { out('a'.repeat(40)); exit(0); }
  if (fmt.includes('.Id')) { out(id); exit(0); }
}
if (a[0] === 'image' && a[1] === 'ls') {
  if (process.env.TEST_IMAGE_LS_FAIL === '1') exit(1);
  if (a[2].startsWith('boardreadyops-web-runtime:')) { out([currentTag, priorTag, obsoleteTag].join('\n')); exit(0); }
  if (a[2].startsWith('boardreadyops-rollback-safety:pre-')) { out('boardreadyops-rollback-safety:pre-old\nboardreadyops-rollback-safety:pre-stopped'); exit(0); }
}
if (a[0] === 'image' && (a[1] === 'rm' || a[1] === 'tag')) {
  fs.appendFileSync(process.env.TEST_DOCKER_LOG, a.join(' ')+'\n');
  if (a[1] === 'rm' && ![obsoleteTag, 'boardreadyops-rollback-safety:pre-old'].includes(a[2])) exit(2);
  exit(0);
}
process.stderr.write('Unexpected Docker mock invocation: '+a.join(' ')+'\n');
exit(2);
`;

afterEach(() => {
  for (const dir of workdirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function runRetention(args: string[], overrides: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boardreadyops-retention-"));
  workdirs.push(dir);
  const dockerPath = path.join(dir, "docker");
  const log = path.join(dir, "docker-calls.log");
  fs.writeFileSync(dockerPath, mockDocker, { mode: 0o755 });
  fs.writeFileSync(log, "");
  const run = spawnSync("bash", [retentionScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_DOCKER_LOG: log, ...overrides },
    timeout: 10000,
  });
  return { ...run, dockerCalls: fs.readFileSync(log, "utf8") };
}

describe("BoardReadyOps runtime image retention", () => {
  it("pins only the running web and worker's identical healthy image", () => {
    const run = runRetention(["pin"]);
    expect(run.status).toBe(0);
    expect(run.dockerCalls).toContain(`image tag ${active} boardreadyops-rollback-safety:verified`);
  });

  it.each([
    [{ TEST_BAD_HEALTH: "1" }, "not healthy"],
    [{ TEST_MISMATCH: "1" }, "different images"],
  ])("refuses pinning a failed health/identity check", (vars, failure) => {
    const run = runRetention(["pin"], vars);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(failure);
    expect(run.dockerCalls).toBe("");
  });

  it.each([
    [{ TEST_NO_PIN: "1" }, "no verified rollback pin"],
    [{ TEST_SAME_PIN: "1" }, "pin equals active"],
  ])("fails closed when there is no distinct previously healthy rollback", (vars, failure) => {
    const run = runRetention(["retire", "--apply"], vars);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(failure);
    expect(run.dockerCalls).toBe("");
  });

  it.each([
    [{ TEST_PS_FAIL: "1" }, "cannot list other container image references"],
    [{ TEST_IMAGE_LS_FAIL: "1" }, "cannot list runtime tags"],
  ])("refuses retirement on a Docker enumeration failure", (vars, reason) => {
    const run = runRetention(["retire", "--apply"], vars);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(reason);
    expect(run.dockerCalls).toBe("");
  });

  it("shows dry-run candidates without deleting active, rollback, stopped or other project images", () => {
    const run = runRetention(["retire"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`would retire ${obsoleteTag}`);
    expect(run.stdout).toContain("would retire boardreadyops-rollback-safety:pre-old");
    expect(run.stdout).toContain(`protected ${currentTag}`);
    expect(run.stdout).toContain(`protected ${priorTag}`);
    expect(run.stdout).toContain("protected boardreadyops-rollback-safety:pre-stopped");
    expect(run.dockerCalls).toBe("");
  });

  it("only removes exact unreferenced tags after explicit apply", () => {
    const run = runRetention(["retire", "--apply"]);
    expect(run.status).toBe(0);
    const calls = run.dockerCalls.trim().split("\n").sort();
    expect(calls).toEqual([`image rm ${obsoleteTag}`, "image rm boardreadyops-rollback-safety:pre-old"].sort());
    expect(run.dockerCalls).not.toContain("--force");
    expect(run.dockerCalls).not.toContain("prune");
  });
});
