import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "packages/db/migrations/0087_signed_runner_tool_versions.sql");

describe("signed runner tool version persistence", () => {
  it("preserves the guarded attempt transition as the sole admission decision", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("boardreadyops_apply_runner_result_state(");
    expect(sql).toContain("if v_transition.transition_outcome = 'applied' then");
    expect(sql).toContain("execution_attempt_id is not distinct from p_expected_execution_attempt_id");
    expect(sql).toContain("terminal_result_digest is not distinct from p_terminal_result_digest");
    expect(sql).toContain("kicad_version = p_kicad_version");
    expect(sql).toContain("board_ready_ops_version = p_board_ready_ops_version");
    expect(sql).toContain("raise exception 'release run identity changed");
    expect(sql).toContain("0087_signed_runner_tool_versions");
  });

  it("enforces database-side bounds even for non-HTTP callers", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("length(p_kicad_version) > 64");
    expect(sql).toContain("length(p_board_ready_ops_version) > 64");
    expect(sql).toContain("invalid runner tool version metadata");
  });
});
