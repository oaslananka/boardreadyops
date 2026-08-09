import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runnerUrl = new URL("../../../docs/deployment/self-hosted-runner.md", import.meta.url);

describe("self-hosted runner deployment documentation", () => {
  it("defines the outbound-only restricted-network contract without overclaiming proxy support", async () => {
    const runner = await readFile(runnerUrl, "utf8");

    expect(runner).toContain("do not publish a Service, load balancer, ingress, SSH port, or callback listener");
    expect(runner).toContain("System time must remain synchronized");
    expect(runner).toContain(
      "Application-level `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` handling is not currently a supported runner contract",
    );
    expect(runner).toContain("transparent egress gateway");
    expect(runner).toContain("customer-local Git mirror");
    expect(runner).toContain("fails closed and leaves the lease recoverable");
  });

  it("documents VM, container, Kubernetes, and disconnected deployment boundaries", async () => {
    const runner = await readFile(runnerUrl, "utf8");

    expect(runner).toContain("Dedicated VM or bare-metal host");
    expect(runner).toContain("read-only root filesystem");
    expect(runner).toContain("do not mount the Docker socket");
    expect(runner).toContain("single-replica `StatefulSet`");
    expect(runner).toContain("No Kubernetes `Service` or `Ingress` is required");
    expect(runner).toContain("Do not share one identity across concurrent replicas");
    expect(runner).toContain("A fully disconnected runner cannot participate");
  });

  it("defines the managed workspace crash-recovery boundary", async () => {
    const runner = await readFile(runnerUrl, "utf8");

    expect(runner).toContain(".boardreadyops-active/<runner-id>");
    expect(runner).toContain("removes only the current runner identity's managed active-workspace namespace");
    expect(runner).toContain("before polling for new work");
    expect(runner).toContain("process-lifetime debug retention, not restart-persistent storage");
    expect(runner).toContain("fails closed before claiming work");
  });

  it("defines an exact-version upgrade, rollback, and re-enrollment contract", async () => {
    const runner = await readFile(runnerUrl, "utf8");

    expect(runner).toContain("exact version validated with the deployed control-plane release");
    expect(runner).toContain("BOARDREADYOPS_SELF_HOSTED_RUNNER_MIN_VERSION");
    expect(runner).toContain("new claim requests");
    expect(runner).toContain("existing leases may drain");
    expect(runner).toContain("Roll out an upgrade one identity at a time");
    expect(runner).toContain("run `boardreadyops doctor`");
    expect(runner).toContain("boardreadyops runner revoke-registration");
    expect(runner).toContain("revoked registration is never reactivated");
    expect(runner).toContain("new unique runner name");
    expect(runner).toContain("new registration ID");
    expect(runner).toContain("active leases are not reassigned");
    expect(runner).not.toContain("boardreadyops runner reissue-enrollment");
    expect(runner).toContain(
      "Copying or regenerating a private key outside enrollment is not a supported rotation procedure",
    );
  });
});
