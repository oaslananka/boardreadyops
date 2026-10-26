# BoardReadyOps AI App — Common MCP Gateway Design

**Status:** local MCP merged; [remote MCP candidate](boardreadyops-remote-mcp.md) under implementation. **Not a deployed remote connector, not an app-directory listing.**

## Product decision

Ship **one BoardReadyOps decision/evidence engine** and one agent-facing MCP contract,
not separate AI products. ChatGPT and Claude are client/distribution channels.
The existing local stdio MCP implementation in `packages/mcp-server` already exposes
`check`, `plan`, and `verify_bundle`, plus a local, counts-only footprint summary tool.
It is not a cloud-hosted MCP endpoint.

## User value and priorities

1. **Now:** Local coding agents (Claude Code, Cursor, other MCP clients) ask for
   deterministic findings, remediation plans, signed bundle verification, and verified
   Git PCB footprint change counts. Keep all KiCad source data in the user's workspace.
2. **Next:** Read-only **remote MCP** for already-authorized hosted Review summaries,
   findings and source-bound, consented digest/count evidence. No Git clone or KiCad
   subprocess on the hosted MCP worker. The hosted Review API/contract remains the
   authority and shall revalidate tenant/repository/review ownership on **every** call.
3. **After remote acceptance:** One portable **MCP Apps** evidence Review UI, tested in
   both ChatGPT and Claude. Show evidence-backed change counts, unavailable coverage,
   policy/DRC findings with links to reviewed objects. Avoid a parallel Claude website;
   continue using BoardReadyOps' existing web app for full workflows.

## Trust and execution boundaries

- **Local stdio MCP:** Invokes only the installed BoardReadyOps CLI with fixed command
  shapes and validated inputs. Read-only by default. No `generate`, `release prepare`,
  auto-fix, waiver or publish tools without a separately reviewed capability-elevation
  design. An AI summary never substitutes for the deterministic pipeline verdict.
- **Hosted remote MCP — not yet implemented:** Dedicated HTTPS MCP resource server,
  standards-compliant OAuth 2.1 / MCP protected resource discovery, PKCE, short-lived
  audience-restricted tokens, token revocation, tenant-scoped `review:read` and
  `evidence:read` permissions. The scopes are **proposed** and do not exist yet.
  Recheck the authenticated user's workspace membership, installation and repository
  authority for **each** review/read; reject cross-tenant ids, stale links and revoked
  scopes. Avoid service credentials shared across customer tenants.
- **Data minimization:** Default remote tools to source hashes, fixed fingerprints,
  bounded counts, deterministic finding text and existing tenant-authorized review
  links. Do not proxy raw `.kicad_pcb`, `.kicad_sch`, BOMs, private repository contents,
  absolute source paths, user tokens or arbitrary local files. Never convert partial
  coverage or `unavailable` to a pass or a removal/addition claim.
- **No open arbitrary process proxy:** Remote tools cannot accept shell commands,
  filesystem paths, URLs to fetch, arbitrary tenant ids, rule bypass flags, prompt
  supplied SQL or mutation actions. Explicit resource ids must resolve to objects in
  the caller's authorized workspace. Enforce rate limits, response-size bounds, audit
  logs without CAD IP, and defensive error normalization.
- **Interactive MCP Apps:** One sandboxed `ui://` review resource showing data returned
  by an authorized `review_get` tool. No long-lived tokens in UI HTML/JS, no direct
  database access, no arbitrary external content or untrusted Markdown executed as
  instructions. All user-triggered tool calls go back through the authenticated MCP
  host. Fall back to structured text when the host lacks MCP Apps support.

## Guarded hosted tool contract (implemented in source, production disabled)

| Tool | Inputs | Authorized response | State |
| --- | --- | --- | --- |
| `boardreadyops_reviews_list` | `limit?` | Bounded recent reviews for one authorized repository | Guarded implementation |
| `boardreadyops_review_get` | `reviewId` | Exact review and current revision metadata | Guarded implementation |
| `boardreadyops_review_findings` | `reviewId` | Up to 30 source-scoped severity/rule fingerprints; no CAD paths or unrestricted messages | Guarded implementation |
| `boardreadyops_review_footprint_summary` | `reviewId` | Consented source-bound digest/count facts, or `unavailable`; MCP Apps view | Guarded implementation |
| `boardreadyops_evidence_get` | `evidenceId` | Authorized metadata-only link; pending artifact-permission model | Planned, not registered |

Tool schemas must be drawn from the existing versioned contracts before implementation.
Do not reuse local stdio filesystem inputs as remote MCP tool inputs.

## Acceptance gates

- Cross-tenant ID probing, wrong-resource OAuth audience, expired/revoked scopes,
  missing membership and repository installation revocation **all** deny by default.
- Host never invokes CLI on a user-provided path, never returns raw CAD source, never
  discloses source on error or in logs. Results have bounded size and stable versioning.
- The UI renders real authorized Review data and an explicit `unavailable` state; no
  demo/fixture evidence can be presented as real source. Works with both ChatGPT and
  Claude using the **same server and UI resource**, with a text fallback.
- Test across tenant, repository, source version and published/revoked review states.
  Review threat model and privacy settings; complete manual client OAuth handshake
  and test against a representative real Git PR before submitting to app directories.
- Observe adoption, review-completion rate, and correction of blocked findings before
  investing in new monetization or mutating tools.

## Explicitly deferred

Production enablement, deployment to live `boardreadyops.com/mcp`, OAuth authorization server
registration/grant issuance, ChatGPT directory submission, Claude connector listing,
write-capable agent tools and additional billing are **not** part of this increment. They must not be claimed or activated before the gates above.

## Upstream references

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Apps](https://apps.extensions.modelcontextprotocol.io/)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/)
- [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
