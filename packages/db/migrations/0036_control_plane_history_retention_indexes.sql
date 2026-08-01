-- Bounded retention scans for completed control-plane delivery and reconciliation history.

create index if not exists control_plane_outbox_completed_retention_idx
  on control_plane_outbox (completed_at, id)
  where status = 'completed';

create index if not exists control_plane_reconciliation_completed_retention_idx
  on control_plane_reconciliation_items (completed_at, id)
  where status = 'completed';

create index if not exists control_plane_reconciliation_subject_lookup_idx
  on control_plane_reconciliation_items (subject_type, subject_id);

create or replace function boardreadyops_purge_completed_control_plane_outbox(
  p_cutoff timestamptz,
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_affected integer;
begin
  if p_cutoff is null then
    raise exception 'p_cutoff is required';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'p_limit must be between 1 and 10000';
  end if;

  -- Prevent a reconciliation reference from being inserted after candidate
  -- selection but before deletion. The bounded delete holds this lock only
  -- for the duration of this function call.
  lock table control_plane_reconciliation_items in share row exclusive mode;

  with terminal as (
    select control_plane_outbox.id
    from control_plane_outbox
    where control_plane_outbox.status = 'completed'
      and control_plane_outbox.completed_at <= p_cutoff
      and not exists (
        select 1
        from control_plane_reconciliation_items
        where control_plane_reconciliation_items.subject_type = 'outbox'
          and control_plane_reconciliation_items.subject_id = control_plane_outbox.id
      )
    order by control_plane_outbox.completed_at asc, control_plane_outbox.id asc
    for update skip locked
    limit p_limit
  ), deleted as (
    delete from control_plane_outbox
    using terminal
    where control_plane_outbox.id = terminal.id
    returning control_plane_outbox.id
  )
  select count(*)::int into v_affected from deleted;

  return v_affected;
end;
$$;
