import { describe, expect, it } from "vitest";
import { verifiedRemoteMcpSource } from "../../../apps/web/lib/remote-mcp-oauth-abuse.js";

describe("trusted ingress OAuth source boundary", () => {
  it("accepts Caddy-supplied single IP addresses only", () => {
    for (const addr of ["192.0.2.1", "2001:db8::1"]) {
      const request = new Request("https://boardreadyops.com/oauth/token", {
        headers: { "x-boardreadyops-verified-client-ip": addr },
      });
      expect(verifiedRemoteMcpSource(request)).toBe(addr);
    }
  });

  it("refuses absent, malformed, multi-valued or caller-forwarded sources", () => {
    for (const supplied of [
      { "x-forwarded-for": "192.0.2.1" },
      { "x-boardreadyops-verified-client-ip": "192.0.2.1, 198.51.100.2" },
      { "x-boardreadyops-verified-client-ip": "attacker" },
      { "x-boardreadyops-verified-client-ip": "192.0.2.1:3000" },
      {},
    ]) {
      const request = new Request("https://boardreadyops.com/oauth/token", { headers: supplied });
      expect(verifiedRemoteMcpSource(request)).toBeNull();
    }
  });
});
