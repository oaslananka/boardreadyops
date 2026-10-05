import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  requiredAgentFiles,
  requiredAgentMarkers,
  verifyAgentInstructions,
} from "../../../scripts/verify-agent-instructions.mjs";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-agent-instructions-"));

  for (const relativePath of requiredAgentFiles) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const markers = requiredAgentMarkers[relativePath] ?? [];
    const routerEntries = relativePath === "AGENTS.md" ? requiredAgentFiles.slice(1) : [];
    await writeFile(absolutePath, [...markers, ...routerEntries].join("\n") + "\n", "utf8");
  }

  const publicRoute = path.join(root, "apps/web/app/AGENTS.md");
  await mkdir(publicRoute, { recursive: true });
  await writeFile(path.join(publicRoute, "route.ts"), "export {};\n", "utf8");
  return root;
}

describe("verify-agent-instructions", () => {
  it("accepts a complete hierarchy with the required boundary markers", async () => {
    const root = await createFixture();

    await expect(verifyAgentInstructions(root)).resolves.toEqual({ files: requiredAgentFiles.length });
  });

  it("rejects a missing nested instruction boundary", async () => {
    const root = await createFixture();
    const requiredPath = path.join(root, "packages/db/AGENTS.md");
    await rename(requiredPath, `${requiredPath}.bak`);

    await expect(verifyAgentInstructions(root)).rejects.toThrow(/missing required agent instruction file/u);
  });

  it("protects the Next.js generated marker block", async () => {
    const root = await createFixture();
    await writeFile(path.join(root, "apps/web/AGENTS.md"), "BEGIN:nextjs-agent-rules\n", "utf8");

    await expect(verifyAgentInstructions(root)).rejects.toThrow(/END:nextjs-agent-rules/u);
  });

  it("keeps the public AGENTS route distinct from repository instructions", async () => {
    const root = await createFixture();
    const publicRoute = path.join(root, "apps/web/app/AGENTS.md");
    await rename(publicRoute, `${publicRoute}.route`);
    await writeFile(publicRoute, "not a route directory\n", "utf8");

    await expect(verifyAgentInstructions(root)).rejects.toThrow(/public discovery route directory/u);
  });
});
