import fs from "node:fs";
import { describe, expect, it } from "vitest";

const deploymentPath = "docs/deployment/self-hosted.md";

describe("self-hosted control-plane portability documentation", () => {
  it("documents a fail-closed VPS migration and cutover procedure", () => {
    const deployment = fs.readFileSync(deploymentPath, "utf8");

    expect(deployment).toContain("VPS migration and portable cutover");
    expect(deployment).toContain("PostgreSQL state");
    expect(deployment).toContain("local artifact volume");
    expect(deployment).toContain("root-only runtime environment");
    expect(deployment).toContain("ingress or tunnel credential");
    expect(deployment).toContain("backup → restore → isolated health → ingress cutover → canaries → old-host shutdown");
    expect(deployment).toContain(
      "Do not start the production ingress on the new host before isolated health checks pass",
    );
    expect(deployment).toContain("Do not destroy the old host until both public and private canaries pass");
    expect(deployment).toContain("The public hostname does not need to change when the ingress credential is portable");
    expect(deployment).toContain("Docker Engine and Docker Compose are the host runtime requirements");
    expect(deployment).toContain("Host Node.js is not required for the Compose build path");
    expect(deployment).toContain("cloud:backup:verify");
    expect(deployment).toContain("control-plane restore drill");
  });
});
