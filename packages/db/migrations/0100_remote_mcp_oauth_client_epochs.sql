-- #1248: a disabled/re-enabled or reconfigured OAuth client must not revive
-- grants, pending consent decisions or authorization codes issued earlier.
-- Existing grant/code rows get NULL epochs and therefore fail CLOSED until
-- separately re-authorized. No publication, client enrollment or activation.
alter table remote_mcp_oauth_clients
  add column if not exists registration_epoch uuid not null default gen_random_uuid();

create or replace function remote_mcp_oauth_rotate_client_epoch()
returns trigger language plpgsql as $$
begin
  if new.enabled is distinct from old.enabled
    or new.redirect_uri is distinct from old.redirect_uri then
    new.registration_epoch := gen_random_uuid();
  else
    -- An update to an unrelated field must not permit rewriting the epoch.
    new.registration_epoch := old.registration_epoch;
  end if;
  return new;
end;
$$;

drop trigger if exists remote_mcp_oauth_client_epoch_refresh on remote_mcp_oauth_clients;
create trigger remote_mcp_oauth_client_epoch_refresh
  before update on remote_mcp_oauth_clients
  for each row execute function remote_mcp_oauth_rotate_client_epoch();

alter table remote_mcp_oauth_authorizations
  add column if not exists client_registration_epoch uuid;
alter table remote_mcp_oauth_grants
  add column if not exists client_registration_epoch uuid;
