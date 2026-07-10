import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertReadinessComment } from "../../../apps/web/lib/github-app-check-run-client.js";

const request = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  request.mockReset();
});

describe("GitHub App readiness comment upsert", () => {
  it("updates the existing marker comment instead of creating duplicates", async () => {
    request
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 41, body: "unrelated" },
          { id: 42, body: "old result\n<!-- boardreadyops:release-readiness -->" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));

    await upsertReadinessComment({
      apiBaseUrl: "https://github.test/api/v3",
      token: "installation-token",
      repositoryOwner: "octo-org",
      repositoryName: "hardware-board",
      pullRequestNumber: 17,
      body: "new result\n<!-- boardreadyops:release-readiness -->",
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://github.test/api/v3/repos/octo-org/hardware-board/issues/17/comments",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer installation-token" }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://github.test/api/v3/repos/octo-org/hardware-board/issues/comments/42",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "new result\n<!-- boardreadyops:release-readiness -->" }),
      }),
    );
  });

  it("creates a marker comment when no previous readiness output exists", async () => {
    request.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse({ id: 99 }, 201));

    await upsertReadinessComment({
      apiBaseUrl: "https://github.test/api/v3",
      token: "installation-token",
      repositoryOwner: "octo-org",
      repositoryName: "hardware-board",
      pullRequestNumber: 17,
      body: "first result\n<!-- boardreadyops:release-readiness -->",
      request,
    });

    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://github.test/api/v3/repos/octo-org/hardware-board/issues/17/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "first result\n<!-- boardreadyops:release-readiness -->" }),
      }),
    );
  });
});
