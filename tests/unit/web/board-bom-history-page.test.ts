import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { loader } = vi.hoisted(() => ({ loader: vi.fn() }));
vi.mock("../../../apps/web/lib/repository-dashboard.js", () => ({
  loadRepositoryBoardHistory: loader,
}));
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { login: "acme", installationIds: [101], userId: 10 },
  })),
}));
vi.mock("../../../apps/web/components/viewer-nav.js", () => ({
  ViewerNav: () => null,
}));

const { default: BoardHistoryPage } = await import(
  "../../../apps/web/app/repositories/[repositoryId]/boards/[boardId]/page.js"
);

const makeHistory = () => ({
  repository: { id: "repo-a", owner: "acme", name: "pcb-projects", private: true },
  board: { id: "board-main", projectPath: "hardware/main/main.kicad_pro", displayName: "Main board", archived: false },
  captures: [
    {
      id: "snapshot-2",
      runId: "run-2",
      snapshotCommitSha: "b".repeat(40),
      runCommitSha: "b".repeat(40),
      componentCount: 20,
      capturedAt: "2026-10-11T00:40:00Z",
      runStatus: "completed",
      runDecision: "pass",
    },
    {
      id: "snapshot-1",
      runId: "run-1",
      snapshotCommitSha: "a".repeat(40),
      runCommitSha: "c".repeat(40),
      componentCount: 19,
      capturedAt: "2026-10-11T00:20:00Z",
      runStatus: "completed",
      runDecision: "fail",
    },
  ],
  hasOlderCaptures: true,
});

async function html() {
  return renderToStaticMarkup(
    await BoardHistoryPage({ params: Promise.resolve({ repositoryId: "repo-a", boardId: "board-main" }) }),
  );
}

describe("board capture timeline route", () => {
  it("shows exact per-board captured revisions and matched source link without fabricating approvals", async () => {
    loader.mockResolvedValueOnce(makeHistory());
    const result = await html();
    expect(loader).toHaveBeenCalledWith("repo-a", "board-main", expect.objectContaining({ installationIds: [101] }));
    expect(result).toContain("Captured BOM revision timeline");
    expect(result).toContain("Main board");
    expect(result).toContain("hardware/main/main.kicad_pro");
    expect(result).toContain("Persistent board record");
    expect(result).toContain('href="/runs/run-2"');
    expect(result).toContain('href="/runs/run-1"');
    expect(result).toContain(
      `href="https://github.com/acme/pcb-projects/blob/${"b".repeat(40)}/hardware/main/main.kicad_pro"`,
    );
    expect(result).toContain("20 recorded components");
    expect(result).toContain("19 recorded components");
    expect(result).toContain("Captured source differs from recorded Run commit");
    expect(result).toContain(`Recorded Run commit: ${"c".repeat(40)}`);
    expect(result).not.toContain(`href="https://github.com/acme/pcb-projects/blob/${"a".repeat(40)}`);
    expect(result).toContain('href="/reviews"');
    expect(result).toContain("Reviews are separately published records");
    expect(result).toContain("a BOM capture alone does not establish a Review decision");
    expect(result).toContain("Older snapshots exist beyond these 20 captures");
    expect(result).toContain("not a verified component diff");
    expect(result).not.toContain("Ready for Fabrication");
  });

  it("shows an observed board with zero captured snapshots without implying absence of hardware", async () => {
    loader.mockResolvedValueOnce({
      ...makeHistory(),
      board: { ...makeHistory().board, archived: true },
      captures: [],
      hasOlderCaptures: false,
    });
    const result = await html();
    expect(result).toContain("No BOM snapshots captured for this board");
    expect(result).toContain("Board discovery does not imply a successful component capture");
    expect(result).toContain("Archived");
    expect(result).not.toContain("Older snapshots exist");
    expect(result).not.toContain("Inspect Run");
  });

  it("never offers an unsafe project source URL", async () => {
    const old = makeHistory();
    loader.mockResolvedValueOnce({
      ...old,
      board: { ...old.board, projectPath: "../private-key" },
      captures: [{ ...old.captures[0], runCommitSha: old.captures[0]?.snapshotCommitSha }],
      hasOlderCaptures: false,
    });
    const result = await html();
    expect(result).toContain("Source path cannot be linked safely");
    expect(result).not.toContain("Open project at this commit");
  });

  it("meets WCAG A/AA on the complete server-rendered capture timeline", async () => {
    loader.mockResolvedValueOnce(makeHistory());
    const markup = await html();
    const window = new Window({ url: "https://boardreadyops.example/repositories/repo-a/boards/board-main" });
    window.document.write(
      `<!doctype html><html lang="en"><head><title>Board evidence history</title></head><body>${markup}</body></html>`,
    );
    const globals = globalThis as unknown as Record<string, unknown>;
    const keys = ["window", "document", "Node", "Element", "Document", "HTMLElement", "SVGElement"] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, globals[key]]));
    Object.assign(globals, {
      window,
      document: window.document,
      Node: window.Node,
      Element: window.Element,
      Document: window.Document,
      HTMLElement: window.HTMLElement,
      SVGElement: window.SVGElement,
    });
    try {
      const axe = (await import("axe-core")).default;
      const result = await axe.run(window.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
      expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(globals, key);
        else Reflect.set(globals, key, value);
      }
      await window.close();
    }
  });

  it("conceals missing and unauthorized board identities as not found", async () => {
    loader.mockResolvedValueOnce(undefined);
    await expect(
      BoardHistoryPage({ params: Promise.resolve({ repositoryId: "repo-a", boardId: "foreign-id" }) }),
    ).rejects.toThrow();
  });
});
