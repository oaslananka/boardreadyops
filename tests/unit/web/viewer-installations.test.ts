import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { UserSession } from "../../../apps/web/lib/user-session.js";
import { viewerInstallations } from "../../../apps/web/lib/viewer-installations.js";

function session(installationIds: number[]): UserSession {
  return {
    userId: 1,
    login: "octocat",
    installationIds,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("viewerInstallations", () => {
  it("returns an empty list for a signed-out viewer (no session)", async () => {
    await expect(viewerInstallations(undefined, "nexar")).resolves.toEqual([]);
  });

  it("returns an empty list when the session has no installations to check", async () => {
    await expect(viewerInstallations(session([]), "nexar")).resolves.toEqual([]);
  });

  it("returns an empty list when no DATABASE_URL is configured, rather than throwing", async () => {
    await expect(viewerInstallations(session([123]), "nexar", {})).resolves.toEqual([]);
  });

  it.runIf(process.env.BOARDREADYOPS_POSTGRES_TESTS === "true")(
    "loads the viewer's non-suspended installations with credential status from Postgres",
    async () => {
      const { createPgQueryExecutor } = await import("../../../packages/db/src/pg-executor.js");
      const connectionString = process.env.DATABASE_URL as string;
      const executor = createPgQueryExecutor({ connectionString });
      const githubInstallationId = Math.floor(Math.random() * 1_000_000_000);
      const installationId = randomUUID();
      try {
        await executor.query(
          `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
           values ($1, $2, 'octocat', 'Organization', 'team')`,
          [installationId, githubInstallationId],
        );

        const result = await viewerInstallations(session([githubInstallationId]), "nexar", {
          DATABASE_URL: connectionString,
        });

        expect(result).toEqual([
          {
            id: installationId,
            githubInstallationId,
            accountLogin: "octocat",
            planTier: "team",
            hasComponentCredential: false,
            componentCredentialRejectedAt: undefined,
            componentCredentialRejectedReason: undefined,
          },
        ]);
      } finally {
        await executor.query("delete from installations where id = $1", [installationId]);
        await executor.close();
      }
    },
  );
});
