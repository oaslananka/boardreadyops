import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cancelledSubscriptionProbe, notCancelledSubscription } from "../../../apps/web/lib/tenant-scope.js";

const libraryDirectory = join(import.meta.dirname, "../../../apps/web/lib");

describe("tenant scope", () => {
  it("references only columns of the installations table", () => {
    // The fragment is spliced into queries that alias nothing, so anything it names has to be in
    // scope under that exact name at every call site.
    const referenced = [...notCancelledSubscription.matchAll(/\b([a-z_]+)\.[a-z_]+/gu)].map((match) => match[1]);
    expect(new Set(referenced)).toEqual(new Set(["installations", "github_marketplace_subscriptions"]));
  });

  it("asks the probe form the same question", () => {
    // The two forms differ only in how the installation reaches them: correlated against the
    // table, or passed in as $1 and $2. Everything else about the rule has to match, because a
    // review that one form hides and the other shows is a leak.
    const shape = (sql: string) =>
      sql
        .replaceAll(/\s+/gu, " ")
        .replaceAll("installations.github_installation_id", "$1")
        .replaceAll("lower(installations.account_login)", "lower($2)")
        .replaceAll(/^not exists \( | \)$| limit 1$/gu, "")
        .trim();

    expect(shape(cancelledSubscriptionProbe)).toBe(shape(notCancelledSubscription));
  });

  it("is the only copy of the rule in apps/web/lib", () => {
    // Eleven hand-written copies existed before this module. The failure mode of a twelfth is not
    // a broken build -- it is a query that silently keeps serving a cancelled tenant because one
    // copy did not get the change the other eleven did.
    const offenders = readdirSync(libraryDirectory)
      .filter((name) => name.endsWith(".ts") && name !== "tenant-scope.ts")
      .filter((name) => readFileSync(join(libraryDirectory, name), "utf8").includes("status = 'canceled'"));

    expect(offenders).toEqual([]);
  });
});
