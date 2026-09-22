import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewPublishCommand } from "../../../src/cli/commands/review.js";

const fixtureRoot = path.resolve("tests/fixtures/projects/safe-basic");

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

describe("CLI review publish command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes rendered review-canvas snapshots of the project's schematic/PCB files in the publish payload", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, runId: "run-1", reviewUrl: "/reviews/rev-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const exitCode = await reviewPublishCommand(
      fixtureRoot,
      {
        dryRun: false,
        upload: "metadata",
        repo: "test-org/test-repo",
        head: "1234567890abcdef1234567890abcdef12345678",
        rule: ["bom.mpn-present"],
        token: "test-token",
      },
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as { snapshots?: unknown[] };

    expect(body.snapshots?.length).toBeGreaterThan(0);
    const schematicSnapshot = body.snapshots?.find(
      (s): s is { kind: string; content: string } => (s as { kind?: string }).kind === "schematic",
    );
    expect(schematicSnapshot).toBeDefined();
    expect(schematicSnapshot?.content).toContain("<svg");
  });

  it("executes review publish in dry-run mode without network calls", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    const exitCode = await reviewPublishCommand(
      fixtureRoot,
      {
        dryRun: true,
        upload: "metadata",
        repo: "test-org/test-repo",
        head: "1234567890abcdef1234567890abcdef12345678",
        rule: ["bom.mpn-present"],
      },
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(exitCode).toBe(0);
    expect(stdout.output).toContain("[DRY RUN] Review publish simulation");
    expect(stdout.output).toContain("Repository: test-org/test-repo");
    expect(stdout.output).toContain("Upload Mode: metadata");
    expect(stdout.output).toContain("Dry run completed successfully");
    expect(stderr.output).toBe("");
  });

  it("fails with helpful message when token is missing in live mode", async () => {
    const stdout = createMockStream();
    const stderr = createMockStream();

    const oldToken = process.env.BOARDREADYOPS_TOKEN;
    delete process.env.BOARDREADYOPS_TOKEN;

    try {
      const exitCode = await reviewPublishCommand(
        fixtureRoot,
        {
          dryRun: false,
          upload: "metadata",
          repo: "test-org/test-repo",
          head: "1234567890abcdef1234567890abcdef12345678",
          rule: ["bom.mpn-present"],
        },
        { stdout: stdout.stream, stderr: stderr.stream },
      );

      expect(exitCode).toBe(1);
      expect(stderr.output).toContain("BOARDREADYOPS_TOKEN is required");
    } finally {
      if (oldToken) process.env.BOARDREADYOPS_TOKEN = oldToken;
    }
  });
});
