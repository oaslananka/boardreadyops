import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const installScript = path.resolve("scripts/install-kicad-ci.sh");

const sudoMock = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'if [[ "$1" == "add-apt-repository" ]]; then exit 0; fi',
  'if [[ "$1" == "apt-get" ]]; then printf "%s\n" "$*" >> "$BRO_MOCK_APT_CALLS"; fi',
  'if [[ "$1" == "apt-get" && "$2" == "update" ]]; then',
  '  case "$BRO_MOCK_APT_MODE" in',
  '    outage) echo "E: Failed to fetch https://ppa.launchpadcontent.net/kicad/kicad-10.0-releases/ubuntu/dists/noble/InRelease 503 Service Unavailable" >&2; exit 100;;',
  '    signature) echo "GPG error: NO_PUBKEY for KiCad 10 PPA" >&2; exit 100;;',
  '    unrelated) echo "E: Failed to fetch https://packages.example.net/not-kicad/InRelease 503 Service Unavailable" >&2; exit 100;;',
  '    mixed) echo "Hit:1 https://ppa.launchpadcontent.net/kicad/kicad-10.0-releases/ubuntu noble InRelease" >&2; echo "E: Failed to fetch https://packages.example.net/not-kicad/InRelease 503 Service Unavailable" >&2; exit 100;;',
  '    multiline) printf "Err:4 https://ppa.launchpadcontent.net/kicad/kicad-10.0-releases/ubuntu noble InRelease\n  503 Service Unavailable\n" >&2; exit 100;;',
  "  esac",
  "fi",
  'if [[ "$1" == "apt-get" && "$2" == "install" && "$BRO_MOCK_APT_MODE" == "deb_outage" ]]; then',
  '  echo "E: Failed to fetch https://ppa.launchpadcontent.net/kicad/kicad-10.0-releases/ubuntu/pool/main/k/kicad/kicad.deb 503 Service Unavailable" >&2',
  "  exit 100",
  "fi",
  "exit 0",
].join("\n");

const dockerMock = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'printf "%s\\n" "$*" >> "$BRO_MOCK_DOCKER_LOG"',
  'case "$1" in',
  "  pull) exit 0;;",
  '  image) echo "$BRO_MOCK_VENDOR";;',
  '  run) echo "$BRO_MOCK_OCI_VERSION";;',
  "  *) exit 50;;",
  "esac",
].join("\n");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bro-kicad-ci-script-"));
  const bin = path.join(root, "bin");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(bin));
  const programs: Record<string, string> = {
    sudo: sudoMock,
    docker: dockerMock,
    sleep: "#!/usr/bin/env bash\nexit 0\n",
    "apt-cache": '#!/usr/bin/env bash\nprintf "kicad:\\n  Candidate: %s\\n" "$BRO_MOCK_CANDIDATE"\n',
    "kicad-cli":
      '#!/usr/bin/env bash\nif [[ "$1" == "version" ]]; then echo "$BRO_MOCK_NATIVE_VERSION"; else exit 40; fi\n',
  };
  await Promise.all(
    Object.entries(programs).map(async ([name, body]) => {
      const file = path.join(bin, name);
      await writeFile(file, body);
      await chmod(file, 0o755);
    }),
  );
  const githubPath = path.join(root, "github-path.txt");
  await writeFile(githubPath, "");
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    BRO_KICAD_VERSION: "10.0",
    BRO_KICAD_PPA_SERIES: "10.0",
    RUNNER_TEMP: root,
    GITHUB_PATH: githubPath,
    GITHUB_WORKSPACE: process.cwd(),
    BRO_MOCK_APT_MODE: "signed",
    BRO_MOCK_CANDIDATE: "10.0.7~ubuntu24.04.1",
    BRO_MOCK_NATIVE_VERSION: "10.0.7",
    BRO_MOCK_OCI_VERSION: "10.0.7",
    BRO_MOCK_VENDOR: "KiCad",
    BRO_MOCK_DOCKER_LOG: path.join(root, "docker.log"),
    BRO_MOCK_APT_CALLS: path.join(root, "apt-calls.log"),
  };
  return { root, env, githubPath };
}

function execute(env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [installScript], { encoding: "utf8", env, timeout: 12000 });
}

// The installer runs only in an Ubuntu GitHub Actions job. Its executable
// mock harness depends on Linux uname, GNU timeout, POSIX permissions and
// Linux-style paths; executing these shell mocks on macOS/Windows would test
// the host shell instead of the supported CI target. The portable structural
// contracts below still run in every OS/Node matrix lane.
describe.runIf(process.platform === "linux")("Linux KiCad 10 signed PPA with official OCI outage fallback", () => {
  it("keeps the signed PPA and native KiCad CLI as the primary path", async () => {
    const f = await fixture();
    try {
      const result = execute(f.env);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Verified genuine KiCad CLI 10.0.7");
      expect(existsSync(f.env.BRO_MOCK_DOCKER_LOG as string)).toBe(false);
      expect(await readFile(f.githubPath, "utf8")).toBe("");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("bounds signed PPA socket inactivity for both update and package download", async () => {
    const f = await fixture();
    try {
      const result = execute(f.env);
      expect(result.status).toBe(0);
      const calls = (await readFile(f.env.BRO_MOCK_APT_CALLS as string, "utf8")).trim().split("\n");
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("apt-get update");
      expect(calls[1]).toContain("apt-get install");
      for (const call of calls) {
        expect(call).toContain("Acquire::Retries=1");
        expect(call).toContain("Acquire::http::Timeout=45");
        expect(call).toContain("Acquire::https::Timeout=45");
      }
      expect(existsSync(f.env.BRO_MOCK_DOCKER_LOG as string)).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("uses only the immutable official image after an explicit KiCad PPA 503", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "outage" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Verified genuine KiCad CLI 10.0.7");
      const log = await readFile(f.env.BRO_MOCK_DOCKER_LOG as string, "utf8");
      expect(log).toContain("ghcr.io/kicad/kicad@sha256:3224d1bf");
      const installed = (await readFile(f.githubPath, "utf8")).trim();
      expect(installed).toBe(path.join(f.root, "kicad-oci-bin"));
      const shim = await readFile(path.join(installed, "kicad-cli"), "utf8");
      expect(shim).toContain("--network none");
      expect(shim).toContain("--read-only");
      expect(shim).toContain("--pull=never");
      expect(shim).toContain("ghcr.io/kicad/kicad@sha256:3224d1bf");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("accepts only a transient signed KiCad package download outage", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "deb_outage" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Verified genuine KiCad CLI 10.0.7");
      const log = await readFile(f.env.BRO_MOCK_DOCKER_LOG as string, "utf8");
      expect(log).toContain("ghcr.io/kicad/kicad@sha256:3224d1bf");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("recognizes the KiCad PPA's multiline APT 503 error without weakening verification", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "multiline" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Verified genuine KiCad CLI 10.0.7");
      const log = await readFile(f.env.BRO_MOCK_DOCKER_LOG as string, "utf8");
      expect(log).toContain("ghcr.io/kicad/kicad@sha256:3224d1bf");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("never substitutes OCI for a different APT repository's HTTP 503", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "unrelated" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("non-KiCad source failed");
      expect(existsSync(f.env.BRO_MOCK_DOCKER_LOG as string)).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("rejects a non-KiCad outage even if a successful KiCad PPA URL appears in the same APT log", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "mixed" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("non-KiCad source failed");
      expect(existsSync(f.env.BRO_MOCK_DOCKER_LOG as string)).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("fails closed on APT signature errors rather than switching distributions", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "signature" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("non-KiCad source failed");
      expect(existsSync(f.env.BRO_MOCK_DOCKER_LOG as string)).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("refuses a KiCad candidate from an old or unrelated Ubuntu package", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_CANDIDATE: "9.0.8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("unexpected candidate");
      expect(existsSync(f.env.BRO_MOCK_DOCKER_LOG as string)).toBe(false);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("refuses a wrong OCI runtime version even when its download succeeds", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "outage", BRO_MOCK_OCI_VERSION: "9.0.8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("Expected real KiCad 10.0.*");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("rejects an OCI image lacking the expected official KiCad vendor metadata", async () => {
    const f = await fixture();
    try {
      const result = execute({ ...f.env, BRO_MOCK_APT_MODE: "outage", BRO_MOCK_VENDOR: "unexpected" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("Unexpected OCI image publisher metadata");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe("cross-platform KiCad CI installation invariants", () => {
  it("pins a single official OCI digest and retains fail-closed signature and version gates", async () => {
    const script = await readFile(installScript, "utf8");
    const digest = "ghcr.io/kicad/kicad@sha256:3224d1bf143185ecc1bd3a1082a36f37f0f4e59d707983a16515a845e3737fc6";
    expect(script.split(digest)).toHaveLength(3);
    expect(script).toContain("NO_PUBKEY");
    expect(script).toContain("BADSIG");
    expect(script).toContain("Hash Sum mismatch");
    expect(script).toContain("transient_ppa_outage");
    expect(script).toContain("--network none");
    expect(script).toContain("--read-only");
    expect(script).toContain("--pull=never");
    expect(script).toContain('[[ "$actual" != "$series".* ]]');
  });

  it("still runs the same KiCad-required Node24/PostgreSQL17 GitHub job", async () => {
    const workflow = await readFile(path.resolve(".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("ci / test-int (Node ");
    expect(workflow).toContain("matrix.node-version == 24 && matrix.postgres-version == '17'");
    expect(workflow).toContain("run: bash scripts/install-kicad-ci.sh");
    expect(workflow).toContain("Run integration tests with JUnit report");
    expect(workflow).not.toContain("continue-on-error: true\n      - name: Install KiCad");
  });
});
