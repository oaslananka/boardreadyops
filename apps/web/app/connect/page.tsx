import Link from "next/link";
import { AppShell, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { configuredRemoteMcpOAuth } from "../../lib/remote-mcp-oauth-config.js";

export const metadata = {
  title: "AI integrations — ChatGPT, Claude & MCP",
  description: "Connect AI assistants to authorized BoardReadyOps hardware review evidence with read-only MCP.",
};

export const dynamic = "force-dynamic";

export default function ConnectAiPage() {
  const isReady =
    process.env.BOARDREADYOPS_REMOTE_MCP_OAUTH_ENABLED === "true" &&
    process.env.BOARDREADYOPS_REMOTE_MCP_HANDLER_READY === "true" &&
    Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) &&
    Boolean(configuredRemoteMcpOAuth(process.env));

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "AI integrations" }]}>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8" id="main-content">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">AI integrations</p>
          <h1 className="text-3xl font-semibold text-foreground">
            Your verified hardware reviews, in your AI assistant
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The proposed ChatGPT and Claude connector reads only eligible BoardReadyOps review evidence. Your GitHub
            permissions are checked on every Review read. The hosted connector is not released yet.
          </p>
        </header>

        <Panel title="Connection status">
          <p className="text-sm font-medium text-foreground">
            {isReady
              ? "Protected connector is configured — awaiting live acceptance"
              : "Cloud connector not yet available"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {isReady
              ? "Security configuration is present, but real ChatGPT/Claude OAuth acceptance, per-user repository permissions and operator rollout approval still need validation."
              : "The local MCP server works today for coding agents. The hosted ChatGPT/Claude connection stays disabled until OAuth, repository grants and cross-client testing have passed security acceptance."}
          </p>
        </Panel>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="ChatGPT">
            <p className="text-sm text-muted-foreground">
              Once released, add BoardReadyOps as a custom MCP app/connector in ChatGPT and approve the requested
              read-only repository access.
            </p>
            {isReady ? (
              <p className="mt-3 break-all font-mono text-sm">https://boardreadyops.com/mcp</p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Connection address will activate after acceptance.</p>
            )}
          </Panel>
          <Panel title="Claude">
            <p className="text-sm text-muted-foreground">
              Once released, connect the same URL using Claude&apos;s custom remote MCP connector. There is no separate
              Claude account or second data store.
            </p>
            {isReady ? (
              <p className="mt-3 break-all font-mono text-sm">https://boardreadyops.com/mcp</p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Connection address will activate after acceptance.</p>
            )}
          </Panel>
        </div>

        <Panel title="What your AI can access">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Authorized Review status, decision and source-bound commit/evidence digest (first release)</li>
            <li>Sandboxed MCP Apps Review panel, readable only through a valid OAuth grant</li>
            <li>
              Recent-review listings, finding fingerprints and footprint counts are still under integration testing
            </li>
            <li>No raw CAD files, unrestricted review messages, or manufacturing approvals</li>
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            An AI assistant cannot approve fabrication, bypass review gates, change your PCB or publish private source
            files through these tools.
          </p>
        </Panel>
        <p className="text-sm text-muted-foreground">
          Start with{" "}
          <Link className="underline underline-offset-2" href="/reviews">
            your hardware reviews
          </Link>
          , or{" "}
          <Link className="underline underline-offset-2" href="/setup">
            connect a GitHub repository
          </Link>
          .
        </p>
      </main>
    </AppShell>
  );
}
