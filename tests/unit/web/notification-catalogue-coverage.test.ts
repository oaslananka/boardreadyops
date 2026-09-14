import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { notificationEventCatalog } from "@boardreadyops/cloud-core/notifications";
import { describe, expect, it } from "vitest";

/**
 * Every event the settings screen offers must actually be produced somewhere.
 *
 * This is the notification-side equivalent of the permission-profile drift test, and it exists
 * because the first cut of this feature shipped a catalogue of five events with exactly one
 * producer. A checkbox a user ticks that can never fire is worse than an absent feature: it
 * looks like coverage, so nobody goes looking for the gap.
 */

const producers = [
  // Where each declared event is constructed. Add the producer, then add it here.
  "../../../apps/web/lib/run-notifications.ts",
  "../../../apps/web/lib/notification-worker.ts",
  "../../../apps/web/worker.ts",
] as const;

async function producerSource(): Promise<string> {
  const contents = await Promise.all(
    producers.map((relative) => readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8")),
  );
  return contents.join("\n");
}

describe("notification catalogue coverage", () => {
  it("has a producer for every event the settings screen offers", async () => {
    const source = await producerSource();
    const missing = notificationEventCatalog.map((event) => event.type).filter((type) => !source.includes(`"${type}"`));

    expect(missing, `declared but never produced: ${missing.join(", ")}`).toEqual([]);
  });

  it("produces nothing the catalogue does not declare", async () => {
    const source = await producerSource();
    const declared = new Set(notificationEventCatalog.map((event) => event.type));
    // Matches `type: "something.with_a_dot"`, the shape every NotificationEvent literal uses.
    const produced = [...source.matchAll(/\btype:\s*"([a-z_]+\.[a-z_]+)"/gu)].map((match) => match[1]);

    expect(produced.length).toBeGreaterThan(0);
    for (const type of produced) {
      expect(declared.has(type as (typeof notificationEventCatalog)[number]["type"]), `undeclared: ${type}`).toBe(true);
    }
  });
});
