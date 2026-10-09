import { describe, expect, it } from "vitest";
import {
  evaluatePluginPermissions,
  isPluginPermission,
  pluginPermissionDenialMessage,
} from "../../../src/core/plugin-permissions.js";

describe("plugin permission evaluation", () => {
  it("accepts only the declared permission identifiers", () => {
    for (const permission of ["fs:read", "fs:write", "network", "process", "kicad-cli"]) {
      expect(isPluginPermission(permission)).toBe(true);
    }
    for (const invalid of [undefined, null, 1, false, {}, [], "", "root", "fs:READ"]) {
      expect(isPluginPermission(invalid)).toBe(false);
    }
  });

  it("defaults to no permission grants and normalizes requested capabilities", () => {
    expect(evaluatePluginPermissions({ specifier: "plugin-pkg", name: "plugin", requested: undefined, config: undefined })).toEqual({
      requested: [],
      allowed: [],
      denied: [],
      approvedBy: [],
    });

    expect(
      evaluatePluginPermissions({
        specifier: "plugin-pkg",
        name: "plugin",
        requested: ["network", "fs:read", "network", "process"],
        config: undefined,
      }),
    ).toEqual({
      requested: ["fs:read", "network", "process"],
      allowed: [],
      denied: ["fs:read", "network", "process"],
      approvedBy: [],
    });
  });

  it("unions default, wildcard, package and plugin-name grants before explicit denies", () => {
    const assessment = evaluatePluginPermissions({
      specifier: "@acme/plugin",
      name: "my-plugin",
      requested: ["network", "kicad-cli", "fs:write", "fs:read", "process", "network"],
      config: {
        default: ["fs:read"],
        allow: {
          "*": ["network"],
          "@acme/plugin": ["kicad-cli"],
          "my-plugin": ["process", "fs:write"],
        },
        deny: {
          "*": ["network"],
          "@acme/plugin": ["process"],
          "my-plugin": ["fs:write"],
        },
      },
    });
    expect(assessment).toEqual({
      requested: ["fs:read", "fs:write", "kicad-cli", "network", "process"],
      allowed: ["fs:read", "kicad-cli"],
      denied: ["fs:write", "network", "process"],
      approvedBy: ["default", "*", "@acme/plugin", "my-plugin"],
    });
  });

  it("does not grant capabilities requested by a different plugin identity", () => {
    const assessment = evaluatePluginPermissions({
      specifier: "@acme/untrusted",
      name: "untrusted",
      requested: ["fs:write", "network"],
      config: {
        allow: {
          "@acme/trusted": ["fs:write"],
          trusted: ["network"],
        },
      },
    });
    expect(assessment).toEqual({
      requested: ["fs:write", "network"],
      allowed: [],
      denied: ["fs:write", "network"],
      approvedBy: [],
    });
  });

  it("records approval sources only for requested capabilities, including subsequently denied ones", () => {
    expect(
      evaluatePluginPermissions({
        specifier: "@acme/plugin",
        name: "my-plugin",
        requested: ["process"],
        config: {
          default: ["fs:read"],
          allow: { "*": ["fs:write"], "@acme/plugin": ["process"], "my-plugin": ["process"] },
          deny: { "@acme/plugin": ["process"] },
        },
      }),
    ).toEqual({
      requested: ["process"],
      allowed: [],
      denied: ["process"],
      approvedBy: ["@acme/plugin", "my-plugin"],
    });

    expect(
      evaluatePluginPermissions({
        specifier: "@acme/plugin",
        name: "my-plugin",
        requested: [],
        config: { default: ["network"], allow: { "*": ["fs:read"] } },
      }),
    ).toEqual({ requested: [], allowed: [], denied: [], approvedBy: [] });
  });

  it("formats unapproved single and multiple capabilities with exact remediation keys", () => {
    expect(
      pluginPermissionDenialMessage({
        specifier: "@acme/plugin",
        name: "my-plugin",
        denied: ["process"],
      }),
    ).toBe(
      'Plugin "@acme/plugin" (my-plugin) requests unapproved permission: process. Add them under pluginPermissions.allow["my-plugin"] or pluginPermissions.allow["@acme/plugin"] after review.',
    );
    expect(
      pluginPermissionDenialMessage({
        specifier: "file:///plugin.js",
        name: "plugin",
        denied: ["fs:write", "network"],
      }),
    ).toBe(
      'Plugin "file:///plugin.js" (plugin) requests unapproved permissions: fs:write, network. Add them under pluginPermissions.allow["plugin"] or pluginPermissions.allow["file:///plugin.js"] after review.',
    );
  });
});
