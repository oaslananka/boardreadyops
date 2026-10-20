/* tsqllint-disable set-quoted-identifier */
-- PostgreSQL migration: SQL Server SET QUOTED_IDENTIFIER is not valid here.
-- Guest manufacturing downloads are now resolved from the persisted, revision-bound
-- artifact, not from a sender-supplied HTTPS URL. Legacy references remain readable;
-- new deliveries require no external URL and never store the bearer token in this column.
alter table deliveries alter column signed_archive_url drop not null;
comment on column deliveries.signed_archive_url is
  'Optional legacy external reference; never used as the guest manufacturing download source.';
