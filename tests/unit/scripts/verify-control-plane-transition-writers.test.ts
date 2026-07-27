import { describe, expect, it } from "vitest";
import {
  findProtectedFunctionOwnershipViolations,
  findRuntimeTransitionWriterViolations,
  latestProtectedFunctionDefinitions,
  verifyControlPlaneTransitionWriters,
} from "../../../scripts/verify-control-plane-transition-writers.mjs";

type SourceFile = { path: string; content: string };

function source(path: string, content: string): SourceFile {
  return { path, content };
}

describe("control-plane transition writer boundary", () => {
  it("accepts guarded database function calls and metadata-only SQL", () => {
    const files = [
      source(
        "packages/db/src/transactional-lifecycle-store.ts",
        "select * from boardreadyops_enqueue_release_run_with_outbox($1)",
      ),
      source("packages/db/src/lifecycle-store.ts", "update repositories set disabled_at = $1"),
      source("apps/web/lib/run-dashboard.ts", "select status from release_runs where id = $1"),
    ];

    expect(findRuntimeTransitionWriterViolations(files)).toEqual([]);
  });

  it.each([
    ["run status", "update release_runs set status = 'completed' where id = $1", "release_runs status"],
    [
      "run pointer",
      "update public.release_runs set execution_attempt_id = $2 where id = $1",
      "release_runs current-attempt pointer",
    ],
    [
      "attempt status",
      "update release_run_attempts set status = 'failed' where id = $1",
      "release_run_attempts status",
    ],
    [
      "attempt insert",
      "insert into public.release_run_attempts (id, run_id, status) values ($1, $2, 'queued')",
      "release_run_attempts insert",
    ],
  ])("rejects a direct %s writer", (_label, content, reason) => {
    expect(findRuntimeTransitionWriterViolations([source("apps/web/unsafe.ts", content)])).toEqual([
      `apps/web/unsafe.ts: ${reason}`,
    ]);
  });

  it("rejects restoration of the retired SQL lifecycle factory", () => {
    expect(
      findRuntimeTransitionWriterViolations([
        source("packages/db/src/legacy.ts", "createSqlGitHubAppLifecycleStore(executor)"),
      ]),
    ).toEqual(["packages/db/src/legacy.ts: retired SQL lifecycle factory"]);
  });

  it("tracks the latest migration that defines each protected function", () => {
    const migrations = [
      source(
        "packages/db/migrations/0023_versioned_release_run_transitions.sql",
        "create or replace function boardreadyops_transition_release_run_state() returns void language sql as $$ select 1 $$;",
      ),
      source(
        "packages/db/migrations/0027_guarded_release_run_supersession.sql",
        "create or replace function boardreadyops_enqueue_release_run_with_outbox() returns void language sql as $$ select 1 $$;",
      ),
      source(
        "packages/db/migrations/0030_unsafe_override.sql",
        "create or replace function boardreadyops_enqueue_release_run_with_outbox() returns void language sql as $$ select 2 $$;",
      ),
    ];

    expect(latestProtectedFunctionDefinitions(migrations)).toMatchObject({
      boardreadyops_transition_release_run_state: "0023_versioned_release_run_transitions.sql",
      boardreadyops_enqueue_release_run_with_outbox: "0030_unsafe_override.sql",
    });
  });

  it("requires the guarded migration to remain the final owner of every protected function", () => {
    const migrations = [
      source(
        "packages/db/migrations/0024_guarded_workflow_dispatch_transition.sql",
        "create or replace function boardreadyops_complete_workflow_dispatch_effect() returns void language sql as $$ select 1 $$;",
      ),
      source(
        "packages/db/migrations/0030_unsafe_override.sql",
        "create or replace function boardreadyops_complete_workflow_dispatch_effect() returns void language sql as $$ select 2 $$;",
      ),
    ];

    expect(findProtectedFunctionOwnershipViolations(migrations)).toContain(
      "boardreadyops_complete_workflow_dispatch_effect: expected 0024_guarded_workflow_dispatch_transition.sql, found 0030_unsafe_override.sql",
    );
  });

  it("fails closed when either runtime writers or migration ownership drift", () => {
    expect(() =>
      verifyControlPlaneTransitionWriters(
        [source("apps/web/unsafe.ts", "update release_runs set status = 'failed'")],
        [
          source(
            "packages/db/migrations/0030_unsafe_override.sql",
            "create or replace function boardreadyops_apply_runner_result_state() returns void language sql as $$ select 1 $$;",
          ),
        ],
      ),
    ).toThrow("Control-plane transition writer boundary failed");
  });
});
