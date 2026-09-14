import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { githubAppActions } from "@boardreadyops/cloud-core/github-capabilities";
import { describe, expect, it } from "vitest";

/**
 * Asserts that capabilities this product declares are reachable from somewhere a user can get to.
 *
 * The failure this exists for happened repeatedly, never once: something is built, unit-tested in
 * isolation, listed in the docs, and connected to nothing. The one-click setup button was gated on
 * props no caller passed, behind an operator-token endpoint no browser can reach. `fix` sat in the
 * CLI help table and never opened a pull request. Neither failed a test, because each piece worked
 * on its own.
 *
 * Two declared surfaces already have this kind of guard: `notification-catalogue-coverage.test.ts`
 * for the event catalogue, and the permission-profile drift test for GitHub App permissions. Rule
 * documentation is generated from the registry, so it cannot drift by construction. What follows
 * covers what was left: the app action surface and the CLI's command routing.
 *
 * These assertions are structural, not behavioural. They cannot tell whether a capability is
 * *useful* -- only that it is *wired*. That is the part CI can hold. See issue #752.
 */

function repositoryPath(relative: string): string {
  return fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
}

describe("declared capabilities are reachable", () => {
  it("handles every GitHub App action the capability catalogue advertises", async () => {
    // Imported rather than scraped out of the source text. Reading the declaration as a string is
    // how the first draft of this test convinced itself the catalogue was empty.
    const actionIds = githubAppActions.map((action) => action.id);
    expect(actionIds.length).toBeGreaterThan(0);

    const surface = await readFile(repositoryPath("apps/web/lib/repository-actions.ts"), "utf8");
    const unhandled = actionIds.filter((id) => !surface.includes(`"${id}"`));

    // Handled includes an explicit refusal: `fix` is named in that surface precisely so it answers
    // with a reason. What this forbids is silence -- an action the catalogue advertises and the
    // action surface has never heard of, which is what the help table used to promise.
    expect(unhandled, `advertised but unreachable: ${unhandled.join(", ")}`).toEqual([]);
  });

  it("offers no app action the capability catalogue does not declare", async () => {
    const declared = new Set<string>(githubAppActions.map((action) => action.id));
    const surface = await readFile(repositoryPath("apps/web/lib/repository-actions.ts"), "utf8");
    const offered = [...surface.matchAll(/\baction === "([a-z-]+)"/gu)]
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id));

    expect(offered.length).toBeGreaterThan(0);
    const undeclared = [...new Set(offered)].filter((id) => !declared.has(id));

    // The reverse direction matters as much: an action the surface accepts but the catalogue never
    // mentions is invisible to the availability check, so the UI cannot tell a user whether their
    // installation can perform it.
    expect(undeclared, `offered but undeclared: ${undeclared.join(", ")}`).toEqual([]);
  });

  it("backs every routable CLI command name with a command module", async () => {
    const cli = await readFile(repositoryPath("src/cli/index.ts"), "utf8");
    const block = cli.slice(cli.indexOf("const commands = new Set(["));
    const names = [...block.slice(0, block.indexOf("]")).matchAll(/"([a-z-]+)"/gu)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name) && name !== "help");

    expect(names.length).toBeGreaterThan(0);

    const modules = new Set(
      (await readdir(repositoryPath("src/cli/commands"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
        .map((entry) => entry.name.replace(/\.ts$/u, "")),
    );

    // A name in that set with no module behind it does not error. Argument parsing accepts it and
    // the dispatcher falls through to `run`, so the user gets a readiness run they never asked for
    // instead of being told there is no such command.
    const unbacked = names.filter((name) => !modules.has(name));
    expect(unbacked, `routable but unimplemented: ${unbacked.join(", ")}`).toEqual([]);
  });
});
