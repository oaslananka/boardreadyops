-- Bounded hourly OAuth retention uses expiry ordering across ALL grant/code
-- rows. These indexes keep SKIP LOCKED cleanup from table-scanning as the
-- hosted installation grows. No public OAuth/MCP routes are enabled here.
create index if not exists remote_mcp_oauth_grants_expiry_idx
  on remote_mcp_oauth_grants(expires_at);
create index if not exists remote_mcp_oauth_authorizations_expiry_idx
  on remote_mcp_oauth_authorizations(expires_at);
