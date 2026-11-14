import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import reviewPublishSchema from "../../../schemas/review-publish-result.schema.json" with { type: "json" };
import {
  type ReviewPublishOptions,
  resolveReviewPublishRef,
  reviewPublishCommand,
  reviewSnapshotIdempotencyKey,
} from "../../../src/cli/commands/review.js";
import { schemaCommand } from "../../../src/cli/commands/schema.js";
import { boardReadyVersion } from "../../../src/generated/version.js";
import { detectKicadCli } from "../../../src/kicad/cli.js";

const fixtureRoot = path.resolve("tests/fixtures/projects/safe-basic");
const headSha = "1234567890abcdef1234567890abcdef12345678";
const server = "https://cloud.example";
const leakedSecret = "private-token-value-that-must-not-leak";
const nativeCli = await detectKicadCli();

function createMockStream(): { stream: NodeJS.WritableStream; output: string } {
  const chunks: string[] = [];
  const stream = {
    write(chunk: string | Buffer): boolean {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    get output() {
      return chunks.join("");
    },
  };
}

function liveOptions(overrides: Partial<ReviewPublishOptions> = {}): ReviewPublishOptions {
  return {
    dryRun: false,
    upload: "metadata",
    repo: "test-org/test-repo",
    head: headSha,
    rule: ["bom.mpn-present"],
    token: "test-token",
    server,
    ...overrides,
  };
}

function successResponse(payload: unknown): Pick<Response, "ok" | "status" | "json"> {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function validateResult(value: unknown): void {
  const validate = new Ajv2020({ allErrors: true }).compile(reviewPublishSchema);
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}

describe("CLI review publish source provenance", () => {
  it("uses the exact checked-out branch and never invents main for a detached or explicit commit", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bro-ref-test-"));
    const run = (...args: string[]) => execFileSync("git", ["-C", temp, ...args], { encoding: "utf8" }).trim();
    try {
      run("init", "-q", "-b", "test/real-two-revisions");
      run("config", "user.name", "Review Test");
      run("config", "user.email", "review@example.test");
      run("commit", "--allow-empty", "-qm", "fixture");
      const sha = run("rev-parse", "HEAD");
      expect(resolveReviewPublishRef(temp, sha)).toBe("refs/heads/test/real-two-revisions");
      expect(resolveReviewPublishRef(temp, "a".repeat(40))).toBe("a".repeat(40));
      run("checkout", "--detach", "-q", "HEAD");
      expect(resolveReviewPublishRef(temp, sha)).toBe(sha);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});

function createCommittedPcbReviewFixture(): { root: string; base: string; head: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-review-optin-"));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Test");
  run("config", "user.email", "review@example.test");
  const pcb = path.join(root, "safe-basic.kicad_pcb");
  const uuid = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
  const original = fs.readFileSync(pcb, "utf8");
  const token = '(footprint "Resistor_SMD:R_0603"';
  if (!original.includes(token)) throw new Error("Missing expected source fixture");
  const basePcb = original.replace(token, `${token} (layer "F.Cu") (at 100 100) (uuid "${uuid}")`);
  fs.writeFileSync(pcb, basePcb);
  run("add", "-A");
  run("commit", "-qm", "base");
  const base = run("rev-parse", "HEAD");
  fs.writeFileSync(pcb, basePcb.replace("(at 100 100)", "(at 101 100)"));
  run("add", "-A");
  run("commit", "-qm", "head");
  return { root, base, head: run("rev-parse", "HEAD") };
}

describe("source-derived idempotency prevents old markerless Reviews", () => {
  const baseSnapshot = {
    name: "kicad_native_F_Cu.svg",
    sha256: "c".repeat(64),
    anchors: [] as Array<{ id: string; kind: "finding"; x: number; y: number; metadata: Record<string, string> }>,
  };
  it("keeps the same committed source and unchanged drawings idempotent", () => {
    const key = reviewSnapshotIdempotencyKey(headSha, "a".repeat(64), [baseSnapshot]);
    expect(key).toBe(reviewSnapshotIdempotencyKey(headSha, "a".repeat(64), [baseSnapshot]));
    expect(key).toMatch(/^publish-[a-f0-9]{40}-[a-f0-9]{16}-[a-f0-9]{16}$/u);
  });
  it("makes a newly source-verified KiCad marker a new Run even when source SHA and finding digest are unchanged", () => {
    const original = reviewSnapshotIdempotencyKey(headSha, "a".repeat(64), [baseSnapshot]);
    const anchored = {
      ...baseSnapshot,
      anchors: [
        {
          id: "actual-kicad-uuid",
          kind: "finding" as const,
          x: 0.2,
          y: 0.4,
          metadata: { provenance: "kicad-json-object-position", sourceUuid: "5d98b95c-d01d-4e88-8c2c-83c62e48cb07" },
        },
      ],
    };
    const updated = reviewSnapshotIdempotencyKey(headSha, "a".repeat(64), [anchored]);
    expect(updated).not.toBe(original);
    expect(updated).toBe(reviewSnapshotIdempotencyKey(headSha, "a".repeat(64), [anchored]));
    expect(reviewSnapshotIdempotencyKey(headSha, "a".repeat(64), [{ ...anchored, sha256: "d".repeat(64) }])).not.toBe(
      updated,
    );
  });
});

describe("CLI review publish command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports a local source-bound Review bundle without an API token or network call", async () => {
    const { root, head } = createCommittedPcbReviewFixture();
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://github.com/test-org/test-repo.git"]);
    const bundlePath = path.join(os.tmpdir(), `bro-review-bundle-${process.pid}-${Date.now()}.json`);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const code = await reviewPublishCommand(
        root,
        liveOptions({
          project: "safe-basic.kicad_pro",
          head,
          repo: "test-org/test-repo",
          token: undefined,
          bundle: bundlePath,
        }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code, stderr.output).toBe(0);
      const envelope = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
      expect(envelope).toMatchObject({
        format: "boardreadyops-review-bundle-v1",
        repository: "test-org/test-repo",
        commitSha: head,
        uploadMode: "metadata",
        payload: {
          repositoryId: "test-org/test-repo",
          commitSha: head,
          triggerKind: "manual",
          findings: expect.any(Array),
          snapshots: expect.any(Array),
        },
      });
      expect(envelope.payload.snapshots).toHaveLength(2);
      expect(envelope.payload.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(stdout.output).toContain("https://cloud.example/reviews/publish");
      expect(stdout.output).not.toContain("<svg");
      expect(fetchMock).not.toHaveBeenCalled();
      if (process.platform !== "win32") expect(fs.statSync(bundlePath).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(bundlePath, { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("never exports a Review bundle with ambiguous origin, dirty source, or conflicting publish options", async () => {
    const { root, head } = createCommittedPcbReviewFixture();
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://github.com/test-org/test-repo.git"]);
    const bundlePath = path.join(os.tmpdir(), `bro-bundle-reject-${process.pid}-${Date.now()}.json`);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      for (const overrides of [
        { repo: "wrong/../repo" },
        { repo: "local-repo" },
        { repo: "other-org/other-repo" },
        { token: "bearer-must-not-be-sent" },
        { shareBom: true },
        { dryRun: true },
        { head: "1".repeat(40) },
      ]) {
        const stdout = createMockStream();
        const stderr = createMockStream();
        const code = await reviewPublishCommand(
          root,
          liveOptions({
            project: "safe-basic.kicad_pro",
            head,
            token: undefined,
            bundle: bundlePath,
            ...overrides,
          }),
          { stdout: stdout.stream, stderr: stderr.stream },
        );
        expect(code, `override ${JSON.stringify(overrides)} ${stderr.output}`).not.toBe(0);
        expect(fs.existsSync(bundlePath)).toBe(false);
      }
      fs.appendFileSync(path.join(root, "safe-basic.kicad_pcb"), "\n; uncommitted board edit\n");
      const stdout = createMockStream();
      const stderr = createMockStream();
      const code = await reviewPublishCommand(
        root,
        liveOptions({ head, project: "safe-basic.kicad_pro", token: undefined, bundle: bundlePath }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code).not.toBe(0);
      expect(fs.existsSync(bundlePath)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(bundlePath, { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("publishes observed BOM rows only with explicit opt-in and exact clean Git source", async () => {
    const { root, head } = createCommittedPcbReviewFixture();
    const fetchMock = vi.fn().mockResolvedValue(
      successResponse({
        ok: true,
        runId: "run-with-bom",
        reviewUrl: "/reviews/bom-review",
        acceptedObservedBom: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const code = await reviewPublishCommand(
        root,
        liveOptions({ project: "safe-basic.kicad_pro", shareBom: true, head }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code, stderr.output).toBe(0);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as {
        commitSha: string;
        boms: Array<{ project: string; components: unknown[] }>;
        bomConsent: boolean;
        bomSha256: string;
        evidenceDigest: string;
      };
      expect(body.commitSha).toBe(head);
      expect(body.bomConsent).toBe(true);
      expect(body.boms.length).toBeGreaterThan(0);
      expect(body.boms[0]?.project).toContain("safe-basic");
      expect(body.bomSha256).toBe(createHash("sha256").update(JSON.stringify(body.boms)).digest("hex"));
      expect(body.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);

      fs.appendFileSync(path.join(root, "safe-basic.kicad_pcb"), "\n; uncommitted BOM edit\n");
      fetchMock.mockClear();
      const rejected = createMockStream();
      const rejectedErr = createMockStream();
      expect(
        await reviewPublishCommand(root, liveOptions({ project: "safe-basic.kicad_pro", shareBom: true, head }), {
          stdout: rejected.stream,
          stderr: rejectedErr.stream,
        }),
      ).toBe(2);
      expect(rejectedErr.output).toContain("clean committed Git HEAD");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("never silently accepts a BOM upload when the server omits its acknowledgment", async () => {
    const { root, head } = createCommittedPcbReviewFixture();
    const fetchMock = vi.fn().mockResolvedValue(
      successResponse({
        ok: true,
        runId: "unacknowledged-bom",
        reviewUrl: "/reviews/not-acknowledged",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const code = await reviewPublishCommand(
        root,
        liveOptions({ project: "safe-basic.kicad_pro", shareBom: true, head }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code).toBe(1);
      expect(stderr.output).toContain("did not acknowledge the observed BOM");
      expect(stdout.output).not.toContain("published successfully");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("requires explicit opt-in and both revisions before sending PCB-derived summary fields", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    expect(
      await reviewPublishCommand(fixtureRoot, liveOptions({ pcb: "safe-basic.kicad_pcb" }), {
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).toBe(2);
    expect(
      await reviewPublishCommand(fixtureRoot, liveOptions({ shareFootprintSummary: true }), {
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends opted-in counts only with committed source digests, requires server acknowledgment", async () => {
    const { root, base, head } = createCommittedPcbReviewFixture();
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const fetchMock = vi.fn().mockResolvedValue(
        successResponse({
          ok: true,
          runId: "run-1",
          reviewUrl: "/reviews/rev-1",
          acceptedFootprintSummary: true,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const options = liveOptions({
        format: "json",
        shareFootprintSummary: true,
        base,
        head,
        pcb: "safe-basic.kicad_pcb",
      });
      const code = await reviewPublishCommand(root, options, { stdout: stdout.stream, stderr: stderr.stream });
      expect(code).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ commitSha: head, baseCommitSha: base, pcbFootprintSummaryConsent: true });
      expect(body.pcbFootprintSummary).toMatchObject({
        disclosure: "counts-and-digests-only",
        baseCommitSha: base,
        headCommitSha: head,
        changes: { added: 0, removed: 0, modified: 1, byField: { positionMm: 1 } },
        riskAssessment: "not-evaluated",
      });
      expect(JSON.stringify(body.pcbFootprintSummary)).not.toContain("bf7f5122-bc89-413e-aa3e-f19064ff92f7");
      expect(JSON.stringify(body.pcbFootprintSummary)).not.toContain("(kicad_pcb");

      fetchMock.mockResolvedValue(successResponse({ ok: true, runId: "run-1", reviewUrl: "/reviews/rev-1" }));
      const rejected = createMockStream();
      const rejectedErr = createMockStream();
      const bad = await reviewPublishCommand(root, options, { stdout: rejected.stream, stderr: rejectedErr.stream });
      expect(bad).toBe(1);
      expect(rejected.output).toBe("");
      expect(rejectedErr.output).toContain("did not acknowledge");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to associate an opted-in source summary with findings from another checked-out revision", async () => {
    const { root, base } = createCommittedPcbReviewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const code = await reviewPublishCommand(
        root,
        liveOptions({ base, head: base, pcb: "safe-basic.kicad_pcb", shareFootprintSummary: true }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code).toBe(2);
      expect(stderr.output).toContain("match checked-out HEAD");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses opted-in summary publication when uncommitted worktree files could contaminate findings", async () => {
    const { root, base, head } = createCommittedPcbReviewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      fs.appendFileSync(path.join(root, "safe-basic.kicad_pcb"), "\n; uncommitted board change\n");
      const code = await reviewPublishCommand(
        root,
        liveOptions({ base, head, pcb: "safe-basic.kicad_pcb", shareFootprintSummary: true }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code).toBe(2);
      expect(stderr.output).toContain("clean committed working tree");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses native design disclosure when the selected Git head differs from the checked-out source", async () => {
    const { root, base } = createCommittedPcbReviewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const code = await reviewPublishCommand(root, liveOptions({ nativeVisuals: true, head: base }), {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      expect(code).toBe(2);
      expect(stderr.output).toContain("match the checked-out Git HEAD");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks native imagery upload from edited or untracked CAD files even when SHA is unchanged", async () => {
    const { root, head } = createCommittedPcbReviewFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      fs.appendFileSync(path.join(root, "safe-basic.kicad_pcb"), "\n; locally edited source\n");
      const modified = await reviewPublishCommand(root, liveOptions({ nativeVisuals: true, head }), {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      expect(modified).toBe(2);
      expect(stderr.output).toContain("clean committed working tree");
      fs.writeFileSync(
        path.join(root, "safe-basic.kicad_pcb"),
        execFileSync("git", ["-C", root, "show", "HEAD:safe-basic.kicad_pcb"], { encoding: "utf8" }),
      );
      fs.writeFileSync(path.join(root, "untracked-board.kicad_pcb"), "not a committed KiCad board");
      const untracked = await reviewPublishCommand(root, liveOptions({ nativeVisuals: true, head }), {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      expect(untracked).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!nativeCli.found)(
    "publishes opted-in native artwork from clean committed source despite KiCad local editor state",
    async () => {
      const { root, head } = createCommittedPcbReviewFixture();
      const stdout = createMockStream();
      const stderr = createMockStream();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(successResponse({ ok: true, runId: "native-run", reviewUrl: "/reviews/native" }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        fs.writeFileSync(path.join(root, "safe-basic.kicad_prl"), "editor state (not design geometry)");
        const code = await reviewPublishCommand(root, liveOptions({ nativeVisuals: true, head }), {
          stdout: stdout.stream,
          stderr: stderr.stream,
        });
        expect(code, stderr.output).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as { commitSha: string; snapshots: unknown[] };
        expect(body.commitSha).toBe(head);
        expect(body.snapshots.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("resolves default review head from the target repository, not CLI process cwd", async () => {
    const { root, head } = createCommittedPcbReviewFixture();
    const stdout = createMockStream();
    const stderr = createMockStream();
    try {
      const options = liveOptions({ dryRun: true });
      delete options.head;
      const code = await reviewPublishCommand(root, options, {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      expect(code).toBe(0);
      expect(stdout.output).toContain(`Commit:     ${head.slice(0, 8)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes rendered review-canvas snapshots of the project's schematic/PCB files in the publish payload", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    const fetchMock = vi
      .fn()
      .mockResolvedValue(successResponse({ ok: true, runId: "run-1", reviewUrl: "/reviews/rev-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as { snapshots?: unknown[] };

    expect(body.snapshots?.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("boms");
    expect(body).not.toHaveProperty("bomConsent");
    const schematicSnapshot = body.snapshots?.find(
      (snapshot): snapshot is { kind: string; content: string } => (snapshot as { kind?: string }).kind === "schematic",
    );
    expect(schematicSnapshot).toBeDefined();
    expect(schematicSnapshot?.content).toContain("<svg");
    expect(
      body.snapshots?.every((snapshot) => !(snapshot as { name?: string }).name?.startsWith("kicad_native_")),
    ).toBe(true);
  });

  it("scopes published snapshots to --project instead of disclosing unrelated workspace designs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-multiproject-review-"));
    const selected = path.join(root, "selected");
    const unrelated = path.join(root, "unrelated");
    fs.cpSync(fixtureRoot, selected, { recursive: true });
    fs.cpSync(fixtureRoot, unrelated, { recursive: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(successResponse({ ok: true, runId: "run-scoped", reviewUrl: "/reviews/scoped" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const stdout = createMockStream();
      const stderr = createMockStream();
      const code = await reviewPublishCommand(
        root,
        liveOptions({
          project: "selected/safe-basic.kicad_pro",
          upload: "snapshots",
        }),
        { stdout: stdout.stream, stderr: stderr.stream },
      );
      expect(code, stderr.output).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(request.body)) as { snapshots: { kind: string; name: string }[] };
      // The selected project has one schematic and two PCB layers. Without
      // --project propagation this incorrectly includes both KiCad projects.
      expect(body.snapshots.filter((item) => item.kind === "schematic")).toHaveLength(1);
      expect(body.snapshots.filter((item) => item.kind === "pcb_layer")).toHaveLength(2);
      expect(body.snapshots).toHaveLength(3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("never enables source-derived design artwork without an explicit opt-in", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ dryRun: true, nativeVisuals: true }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(nativeCli.found ? 0 : 1);
    if (nativeCli.found) {
      expect(stdout.output).toContain("Upload Mode: snapshots");
      expect(stdout.output).toContain("Verified KiCad artwork:");
    } else {
      expect(stderr.output).toContain("Native visual preflight failed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the human-oriented text result by default", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(successResponse({ ok: true, runId: "run-1", reviewUrl: "/reviews/rev-1" })),
    );

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions(), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("Hardware review published successfully!");
    expect(stdout.output).toContain("Review URL: https://cloud.example/reviews/rev-1");
    expect(stdout.output).toContain("Evidence Digest:");
    expect(stderr.output).toBe("");
  });

  it("emits one versioned schema-valid JSON document for a published review", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        successResponse({
          ok: true,
          runId: "run-1",
          reviewUrl: "/reviews/rev-1",
          internalTrace: leakedSecret,
        }),
      ),
    );

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ format: "json" }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.output) as Record<string, unknown>;
    validateResult(result);
    expect(result).toEqual({
      schemaVersion: 1,
      tool: { name: "boardreadyops", version: boardReadyVersion },
      success: true,
      dryRun: false,
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      reviewUrl: "https://cloud.example/reviews/rev-1",
      runId: "run-1",
    });
    expect(stdout.output).not.toContain("Analyzing hardware preflight");
    expect(stdout.output).not.toContain("Publishing review");
    expect(stdout.output).not.toContain(leakedSecret);
    expect(stderr.output).toBe("");
  });

  it("resolves a runId-only service response deterministically", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse({ ok: true, runId: "run 1/slash" })));

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ format: "json" }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.output) as { reviewUrl: string; runId: string };
    expect(result.reviewUrl).toBe("https://cloud.example/runs/run%201%2Fslash");
    expect(result.runId).toBe("run 1/slash");
    validateResult(result);
  });

  it("rejects a cross-origin reviewUrl instead of redirecting a consumer away from the configured service", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(successResponse({ ok: true, reviewUrl: "https://evil.example/reviews/rev-1" })),
    );

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ format: "json" }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toContain("Unexpected server response");
    expect(stderr.output).not.toContain("evil.example");
  });

  it("executes review publish in text dry-run mode without network calls", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const exitCode = await reviewPublishCommand(
      fixtureRoot,
      {
        dryRun: true,
        upload: "metadata",
        repo: "test-org/test-repo",
        head: headSha,
        rule: ["bom.mpn-present"],
      },
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stdout.output).toContain("[DRY RUN] Review publish simulation");
    expect(stdout.output).toContain("Repository: test-org/test-repo");
    expect(stdout.output).toContain("Upload Mode: metadata");
    expect(stdout.output).toContain("Dry run completed successfully");
    expect(stderr.output).toBe("");
  });

  it("emits a schema-valid JSON dry-run result without contacting the service", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const exitCode = await reviewPublishCommand(
      fixtureRoot,
      {
        dryRun: true,
        format: "json",
        upload: "metadata",
        repo: "test-org/test-repo",
        head: headSha,
        rule: ["bom.mpn-present"],
      },
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const result = JSON.parse(stdout.output) as Record<string, unknown>;
    validateResult(result);
    expect(result).toMatchObject({
      schemaVersion: 1,
      tool: { name: "boardreadyops", version: boardReadyVersion },
      success: true,
      dryRun: true,
    });
    expect(result).not.toHaveProperty("reviewUrl");
    expect(result).not.toHaveProperty("runId");
    expect(stderr.output).toBe("");
  });

  it("fails closed with empty JSON stdout when the token is missing", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const oldToken = process.env.BOARDREADYOPS_TOKEN;
    delete process.env.BOARDREADYOPS_TOKEN;

    try {
      const exitCode = await reviewPublishCommand(
        fixtureRoot,
        {
          dryRun: false,
          format: "json",
          upload: "metadata",
          repo: "test-org/test-repo",
          head: headSha,
          rule: ["bom.mpn-present"],
        },
        { stdout: stdout.stream, stderr: stderr.stream },
      );

      expect(exitCode).toBe(1);
      expect(stdout.output).toBe("");
      expect(stderr.output).toContain("BOARDREADYOPS_TOKEN is required");
    } finally {
      if (oldToken === undefined) delete process.env.BOARDREADYOPS_TOKEN;
      else process.env.BOARDREADYOPS_TOKEN = oldToken;
    }
  });

  it("does not echo a non-2xx service response body or credentials", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const text = vi.fn(async () => `Authorization: Bearer ${leakedSecret}`);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text }));

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ format: "json", token: leakedSecret }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(text).not.toHaveBeenCalled();
    expect(stderr.output).toBe("❌ Server error (401).\n");
    expect(stderr.output).not.toContain(leakedSecret);
  });

  it("fails closed on malformed or partial service responses without echoing private fields", async () => {
    for (const response of [
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error(`malformed ${leakedSecret}`);
        },
      },
      successResponse({ ok: true, privateUploadPath: leakedSecret }),
    ]) {
      const stdout = createMockStream();
      const stderr = createMockStream();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ format: "json" }), {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      expect(exitCode).toBe(1);
      expect(stdout.output).toBe("");
      expect(stderr.output).toBe("❌ Unexpected server response.\n");
      expect(stderr.output).not.toContain(leakedSecret);
    }
  });

  it("fails closed on network errors without echoing exception details or credentials", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`Authorization: Bearer ${leakedSecret}`)));

    const exitCode = await reviewPublishCommand(fixtureRoot, liveOptions({ format: "json", token: leakedSecret }), {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(stderr.output).toBe("❌ Network error while publishing review. Check connectivity and try again.\n");
    expect(stderr.output).not.toContain(leakedSecret);
  });

  it("ships the versioned review-publish schema through the schema command", () => {
    const stdout = createMockStream();

    expect(schemaCommand("review-publish", { stdout: stdout.stream, stderr: createMockStream().stream })).toBe(0);
    expect(JSON.parse(stdout.output)).toEqual(reviewPublishSchema);
  });
});
