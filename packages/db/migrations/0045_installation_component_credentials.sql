-- Per-installation component intelligence credentials, encrypted at rest.
--
-- ADR-0012 concluded that lookups run under each customer's own provider licence rather than
-- one BoardReadyOps subscription, because the leading provider's terms make a shared
-- subscription the cross-tenant use they forbid. That means the control plane stores a secret
-- belonging to someone else.
--
-- The ciphertext column holds an authenticated envelope produced in the application; the key
-- lives in the process environment, never in this database. A dump, a backup, or a read
-- replica is therefore not a credential leak on its own.
--
-- One credential per installation per provider. The provider name is constrained to the same
-- shape as other identifiers here rather than being free text, so a typo cannot quietly create
-- a second row that never matches a lookup.

create table if not exists installation_component_credentials (
  installation_id text not null references installations(id) on delete cascade,
  provider text not null,
  -- Authenticated envelope, not raw ciphertext: tampering fails closed rather than decrypting
  -- to plausible bytes that would then be sent to a provider as a bearer token.
  credential_envelope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when a lookup is refused by the provider, so the watch can report a credential problem
  -- instead of silently reporting boards as unchecked forever.
  last_rejected_at timestamptz,
  last_rejected_reason text,
  primary key (installation_id, provider)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_credentials_provider_valid'
  ) then
    alter table installation_component_credentials
      add constraint installation_component_credentials_provider_valid
      check (provider ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and char_length(provider) between 1 and 64);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_credentials_envelope_valid'
  ) then
    alter table installation_component_credentials
      add constraint installation_component_credentials_envelope_valid
      check (char_length(credential_envelope) between 1 and 8192);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'installation_component_credentials_rejection_valid'
  ) then
    alter table installation_component_credentials
      add constraint installation_component_credentials_rejection_valid
      check ((last_rejected_at is null) = (last_rejected_reason is null));
  end if;
end $$;

insert into cloud_schema_migrations (version)
values ('0045_installation_component_credentials')
on conflict (version) do nothing;
