/* tsqllint-disable set-quoted-identifier */
-- PostgreSQL migration: SQL Server SET QUOTED_IDENTIFIER is not valid here.
-- Index-only, additive support for bounded remote MCP Review finding keyset reads.
-- A current Review is authorized against its head run before the query executes;
-- keeping the index run-prefixed avoids scanning findings from other runs.
-- Deployment remains separately gated: ordinary CREATE INDEX can block writers
-- during a busy migration; evaluate production rollout before applying.
create index if not exists findings_run_id_idx
  on findings(run_id, id);
