import { describe, expect, it, vi } from "vitest";
import { resolveSettingsTenantScope } from "../../../apps/web/lib/settings-tenant.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const session = { login: "octocat", installationIds: [11, 22] } as unknown as UserSession;
const installations = [
  { id: "inst-a", githubInstallationId: 11, accountLogin: "acme", planTier: "business" },
  { id: "inst-b", githubInstallationId: 22, accountLogin: "beta", planTier: "team" },
] as const;

describe("resolveSettingsTenantScope", () => {
  it("defaults to the first installation from the server-derived session scope", async () => {
    const loadInstallations = vi.fn().mockResolvedValue(installations);
    await expect(resolveSettingsTenantScope(session, undefined, { loadInstallations })).resolves.toMatchObject({
      selected: { id: "inst-a", accountLogin: "acme" },
      installations,
    });
  });

  it("honours an explicitly selected installation that belongs to the viewer", async () => {
    const loadInstallations = vi.fn().mockResolvedValue(installations);
    await expect(resolveSettingsTenantScope(session, "inst-b", { loadInstallations })).resolves.toMatchObject({
      selected: { id: "inst-b", accountLogin: "beta" },
    });
  });

  it("does not fall back when a submitted installation id is outside the viewer scope", async () => {
    const loadInstallations = vi.fn().mockResolvedValue(installations);
    const result = await resolveSettingsTenantScope(session, "someone-else", { loadInstallations });
    expect(result.selected).toBeUndefined();
  });

  it("returns no selected tenant for signed-out viewers", async () => {
    const loadInstallations = vi.fn();
    await expect(resolveSettingsTenantScope(undefined, undefined, { loadInstallations })).resolves.toEqual({
      installations: [],
      selected: undefined,
    });
    expect(loadInstallations).not.toHaveBeenCalled();
  });
});
