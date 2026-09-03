import { describe, expect, it } from "vitest";
import {
  buildDeadLetterListUrl,
  buildDeadLetterReplayUrl,
  formatFailureReason,
  formatTimestamp,
  replayOutcomeMessage,
} from "../../../apps/web/app/ops/dead-letters/dead-letter-view-model.js";

describe("dead-letter view model", () => {
  it("formats failure reason with error class when present", () => {
    expect(formatFailureReason({ reasonCode: "delivery_timeout", errorClass: "NetworkError" })).toBe(
      "delivery_timeout (NetworkError)",
    );
  });

  it("formats failure reason as just the reason code without an error class", () => {
    expect(formatFailureReason({ reasonCode: "max_attempts_exceeded" })).toBe("max_attempts_exceeded");
  });

  it("formats a valid ISO timestamp", () => {
    expect(formatTimestamp("2026-09-03T01:02:03.000Z")).toBe("2026-09-03 01:02");
  });

  it("reports unknown for a missing or unparsable timestamp", () => {
    expect(formatTimestamp(undefined)).toBe("unknown");
    expect(formatTimestamp("not-a-date")).toBe("unknown");
  });

  it("maps every replay outcome to a distinct human message", () => {
    expect(replayOutcomeMessage("replayed")).toMatch(/requeued/);
    expect(replayOutcomeMessage("already_applied")).toMatch(/idempotent/);
    expect(replayOutcomeMessage("not_found")).toMatch(/no longer exists/);
    expect(replayOutcomeMessage("not_replayable")).toMatch(/reconciliation/);
  });

  it("builds the list URL with installation scoping and optional cursor/limit", () => {
    expect(buildDeadLetterListUrl({ installationId: "ins_1" })).toBe(
      "/api/v1/operator/installations/ins_1/dead-letters",
    );
    expect(buildDeadLetterListUrl({ installationId: "ins_1", limit: 25 })).toBe(
      "/api/v1/operator/installations/ins_1/dead-letters?limit=25",
    );
    expect(buildDeadLetterListUrl({ installationId: "ins_1", before: "2026-09-03T00:00:00.000Z" })).toBe(
      "/api/v1/operator/installations/ins_1/dead-letters?before=2026-09-03T00%3A00%3A00.000Z",
    );
  });

  it("encodes installation id, item type, and item id in the replay URL", () => {
    expect(buildDeadLetterReplayUrl({ installationId: "ins 1", itemType: "job", itemId: "job/1" })).toBe(
      "/api/v1/operator/installations/ins%201/dead-letters/job/job%2F1/replay",
    );
  });
});
