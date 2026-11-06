-- Tenant-scoped serialize point-in-time historical USER transfer reads against
-- new erasure requests and newly added artifact references. This does NOT
-- create or authorize a download, worker, persistent lease, or public route.
-- Never use a global erasure/artifacts table lock around HTTP transport.
CREATE OR REPLACE FUNCTION boardreadyops_historical_transfer_tenant_lock_key(p_tenant text)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT hashtextextended('boardreadyops/historical-transfer/v1:' || lower(p_tenant), 0);
$$;

-- All writers (including raw SQL) participate, so a new running erasure
-- request cannot be inserted in the middle of an admitted transfer chunk.
CREATE OR REPLACE FUNCTION boardreadyops_guard_historical_transfer_erasure_writer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old text := CASE WHEN TG_OP <> 'INSERT' THEN lower(OLD.tenant_id) ELSE NULL END;
  v_new text := CASE WHEN TG_OP <> 'DELETE' THEN lower(NEW.tenant_id) ELSE NULL END;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  IF v_old IS NOT NULL AND (v_new IS NULL OR v_old <= v_new) THEN
    PERFORM pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key(v_old));
  END IF;
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    PERFORM pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key(v_new));
  END IF;
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_old > v_new THEN
    PERFORM pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key(v_old));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_transfer_erasure_writer
  ON public.erasure_requests;
CREATE TRIGGER boardreadyops_historical_transfer_erasure_writer
BEFORE INSERT OR UPDATE OR DELETE ON public.erasure_requests
FOR EACH ROW EXECUTE FUNCTION boardreadyops_guard_historical_transfer_erasure_writer();

-- A new artifact under any retained repository is a potential manifest
-- phantom. Lock just its verified installation tenant, never every tenant.
-- Existing artifact row changes are already blocked by the gate's FOR SHARE.
CREATE OR REPLACE FUNCTION boardreadyops_guard_historical_transfer_new_artifact()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT lower(i.account_login) INTO v_tenant
    FROM public.release_runs AS run
    JOIN public.repositories AS repo ON repo.id=run.repository_id
    JOIN public.installations AS i ON i.id=repo.installation_id
   WHERE run.id=NEW.run_id
     AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL;
  IF v_tenant IS NOT NULL THEN
    PERFORM set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock(
      boardreadyops_historical_transfer_tenant_lock_key(v_tenant)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_transfer_artifact_writer
  ON public.artifacts;
CREATE TRIGGER boardreadyops_historical_transfer_artifact_writer
BEFORE INSERT OR UPDATE OF run_id ON public.artifacts
FOR EACH ROW EXECUTE FUNCTION boardreadyops_guard_historical_transfer_new_artifact();

-- Direct SQL and retention workers may queue a new physical deletion job
-- without changing an artifact row in the same transaction. Serialize new
-- queues with the same tenant lock; existing queued jobs already cause the
-- historical USER gate to reject the entire manifest.
-- Include reparent/repath so an unrelated queued job cannot be moved into an
-- active suspended USER tenant behind the gate.
CREATE OR REPLACE FUNCTION boardreadyops_guard_historical_transfer_deletion_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT lower(i.account_login) INTO v_tenant
    FROM public.installations AS i
   WHERE i.id=NEW.installation_id
     AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL;
  IF v_tenant IS NOT NULL THEN
    PERFORM set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock(
      boardreadyops_historical_transfer_tenant_lock_key(v_tenant)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_transfer_deletion_queue_writer
  ON public.artifact_deletion_jobs;
CREATE TRIGGER boardreadyops_historical_transfer_deletion_queue_writer
BEFORE INSERT OR UPDATE OF installation_id,storage_path ON public.artifact_deletion_jobs
FOR EACH ROW EXECUTE FUNCTION boardreadyops_guard_historical_transfer_deletion_queue();

-- Audit events are append-only but an INSERT can change a signed USER's
-- historical metadata count during an admitted test-only transport chunk.
-- Do not weaken audit_events' existing update/delete rejection triggers.
-- Resolve through the actual installation ID, never a recycled login alone.
CREATE OR REPLACE FUNCTION boardreadyops_guard_historical_transfer_new_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT lower(i.account_login) INTO v_tenant
    FROM public.installations AS i
   WHERE i.id=NEW.installation_id
     AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL;
  IF v_tenant IS NOT NULL THEN
    PERFORM set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock(
      boardreadyops_historical_transfer_tenant_lock_key(v_tenant)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_transfer_audit_writer
  ON public.audit_events;
CREATE TRIGGER boardreadyops_historical_transfer_audit_writer
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION boardreadyops_guard_historical_transfer_new_audit();

-- Review INSERTs are another snapshot phantom, even when they have no new
-- physical artifacts. The parent repository remains the scope authority.
CREATE OR REPLACE FUNCTION boardreadyops_guard_historical_transfer_new_review()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  -- Protect both the old and new original USER scopes on a reparent. Taking
  -- only NEW.repository_id would allow a review to leave a protected
  -- historical snapshot during its bounded transfer transaction.
  IF TG_OP='UPDATE' THEN
    SELECT lower(i.account_login) INTO v_old
      FROM public.repositories AS repo
      JOIN public.installations AS i ON i.id=repo.installation_id
     WHERE repo.id=OLD.repository_id
       AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL;
  END IF;
  SELECT lower(i.account_login) INTO v_new
    FROM public.repositories AS repo
    JOIN public.installations AS i ON i.id=repo.installation_id
   WHERE repo.id=NEW.repository_id
     AND lower(i.account_type)='user' AND i.suspended_at IS NOT NULL;

  IF v_old IS NOT NULL OR v_new IS NOT NULL THEN
    PERFORM set_config('lock_timeout', '5s', true);
    -- Acquire multiple keys in a deterministic order for concurrent
    -- two-way repository reparent operations.
    IF v_old IS NOT NULL AND (v_new IS NULL OR v_old <= v_new) THEN
      PERFORM pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key(v_old));
    END IF;
    IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
      PERFORM pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key(v_new));
    END IF;
    IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_old > v_new THEN
      PERFORM pg_advisory_xact_lock(boardreadyops_historical_transfer_tenant_lock_key(v_old));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boardreadyops_historical_transfer_review_writer
  ON public.reviews;
CREATE TRIGGER boardreadyops_historical_transfer_review_writer
BEFORE INSERT OR UPDATE OF repository_id ON public.reviews
FOR EACH ROW EXECUTE FUNCTION boardreadyops_guard_historical_transfer_new_review();

INSERT INTO public.cloud_schema_migrations(version)
VALUES ('0117_historical_user_transfer_tenant_fence')
ON CONFLICT (version) DO NOTHING;
