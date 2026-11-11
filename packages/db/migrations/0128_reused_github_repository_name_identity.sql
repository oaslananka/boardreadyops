-- GitHub's numeric repository ID is the immutable identity. A removed
-- repository can be replaced by a DIFFERENT repository with the same
-- installation, owner and name. Preserve disabled historical records
-- without blocking a replacement or relabeling any existing evidence.
--
-- Keep uniqueness among active records; a second active repository
-- claiming the same name is a conflict and must fail closed.
create unique index if not exists repositories_active_installation_owner_name_key
  on repositories (installation_id, owner, name)
  where disabled_at is null;

alter table repositories
  drop constraint if exists repositories_installation_id_owner_name_key;
