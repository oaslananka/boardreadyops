import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const requiredAgentFiles = [
  "AGENTS.md",
  ".github/AGENTS.md",
  "apps/web/AGENTS.md",
  "apps/web/app/api/AGENTS.md",
  "apps/web/lib/AGENTS.md",
  "deploy/AGENTS.md",
  "packages/cloud-core/AGENTS.md",
  "packages/contracts/AGENTS.md",
  "packages/db/AGENTS.md",
  "packages/mcp-server/AGENTS.md",
  "packages/plugin-sdk/AGENTS.md",
  "src/action/AGENTS.md",
  "src/bom/AGENTS.md",
  "src/cli/AGENTS.md",
  "src/core/AGENTS.md",
  "src/kicad/AGENTS.md",
  "src/pinmap/AGENTS.md",
  "src/release/AGENTS.md",
  "src/report/AGENTS.md",
  "src/rules/AGENTS.md",
  "src/runner/AGENTS.md",
  "src/util/AGENTS.md",
];

export const requiredAgentMarkers = {
  "AGENTS.md": [
    "closest applicable `AGENTS.md` wins",
    "Authentication proves identity, not resource authority",
    "The MCP server is read-only by default",
  ],
  ".github/AGENTS.md": ["required status checks", "full commit SHAs", "Trusted Publishing/OIDC"],
  "apps/web/AGENTS.md": ["BEGIN:nextjs-agent-rules", "END:nextjs-agent-rules"],
  "apps/web/app/api/AGENTS.md": ["bounded request body", "server-side authorization", "signature-verified"],
  "apps/web/lib/AGENTS.md": ["Authentication is not authorization", "correlation ID", "nonce/replay"],
  "deploy/AGENTS.md": ["dry-run", "rollback", "outbound-only"],
  "packages/cloud-core/AGENTS.md": [
    "Fail closed",
    "plaintext fallback persistence",
    "Unknown policy facts do not become permission",
  ],
  "packages/contracts/AGENTS.md": ["wire contracts", "backward compatibility", "fail closed"],
  "packages/db/AGENTS.md": ["canonical tenant scope", "parameterized SQL", "Migrations are ordered, additive history"],
  "packages/mcp-server/AGENTS.md": ["Read-only by default", "capability-elevation design", "deterministic CLI"],
  "packages/plugin-sdk/AGENTS.md": ["Plugins are not a sandbox", "trusted project code", "Safe mode"],
  "src/core/AGENTS.md": ["Safe mode is the security boundary", "trusted project code", "verify:structure"],
  "src/release/AGENTS.md": ["Ed25519", "SHA-256", "fails closed"],
  "src/runner/AGENTS.md": ["exact assigned commit SHA", "outbound-only", "mutually bound"],
};

export async function verifyAgentInstructions(repositoryRoot = process.cwd()) {
  const failures = [];
  const contents = new Map();

  for (const relativePath of requiredAgentFiles) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        failures.push(`${relativePath} must be a regular file`);
        continue;
      }
      contents.set(relativePath, await readFile(absolutePath, "utf8"));
    } catch {
      failures.push(`missing required agent instruction file: ${relativePath}`);
    }
  }

  const root = contents.get("AGENTS.md");
  if (root) {
    for (const nestedPath of requiredAgentFiles.slice(1)) {
      if (!root.includes(nestedPath)) {
        failures.push(`root AGENTS.md must route to ${nestedPath}`);
      }
    }
  }

  for (const [relativePath, markers] of Object.entries(requiredAgentMarkers)) {
    const content = contents.get(relativePath);
    if (!content) continue;
    for (const marker of markers) {
      if (!content.includes(marker)) {
        failures.push(`${relativePath} is missing required marker: ${marker}`);
      }
    }
  }

  const publicAgentRouteDirectory = path.join(repositoryRoot, "apps/web/app/AGENTS.md");
  try {
    const info = await stat(publicAgentRouteDirectory);
    if (!info.isDirectory()) {
      failures.push("apps/web/app/AGENTS.md must remain the public discovery route directory");
    }
  } catch {
    failures.push("missing public discovery route directory: apps/web/app/AGENTS.md");
  }

  try {
    const info = await stat(path.join(publicAgentRouteDirectory, "route.ts"));
    if (!info.isFile()) failures.push("apps/web/app/AGENTS.md/route.ts must remain a file");
  } catch {
    failures.push("missing public agent discovery route: apps/web/app/AGENTS.md/route.ts");
  }

  if (failures.length > 0) {
    throw new Error(`agent instruction verification failed:\n- ${failures.join("\n- ")}`);
  }

  return { files: requiredAgentFiles.length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await verifyAgentInstructions();
  process.stdout.write(`agent instruction verification passed (${result.files} files)\n`);
}
