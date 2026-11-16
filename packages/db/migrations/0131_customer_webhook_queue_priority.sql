-- Prioritize user-visible PR lifecycle and revocations over high-volume workflow progress.
-- Preserve the original lease, idempotency and delivery-order invariants within each class.
-- Only reclassify jobs still available; terminal/leased rows are never replayed or mutated.

create or replace function boardreadyops_accept_github_webhook(
  p_inbox_id text,
  p_job_id text,
  p_provider text,
  p_delivery_id text,
  p_event_type text,
  p_event_action text,
  p_installation_external_id bigint,
  p_repository_external_id bigint,
  p_repository_full_name text,
  p_payload_sha256 text,
  p_normalized_actions jsonb,
  p_received_at timestamptz,
  p_retention_until timestamptz,
  p_max_attempts integer default 8
)
returns table(outcome text, inbox_id text, job_id text)
language plpgsql
security invoker
as $$
declare
  v_inbox_id text;
  v_job_id text;
  v_existing_digest text;
begin
  insert into webhook_inbox (
    id, provider, delivery_id, event_type, event_action,
    installation_external_id, repository_external_id, repository_full_name,
    payload_version, payload_sha256, normalized_actions, state,
    received_at, last_received_at, retention_until
  ) values (
    p_inbox_id, p_provider, p_delivery_id, p_event_type, p_event_action,
    p_installation_external_id, p_repository_external_id, p_repository_full_name,
    1, p_payload_sha256, p_normalized_actions, 'accepted',
    p_received_at, p_received_at, p_retention_until
  )
  on conflict (provider, delivery_id) do nothing
  returning id into v_inbox_id;

  if v_inbox_id is null then
    select wi.id, wi.payload_sha256
      into v_inbox_id, v_existing_digest
      from webhook_inbox wi
     where wi.provider = p_provider and wi.delivery_id = p_delivery_id
     for update;

    update webhook_inbox
       set duplicate_count = duplicate_count + 1,
           duplicate_payload_mismatch_count = duplicate_payload_mismatch_count
             + case when v_existing_digest = p_payload_sha256 then 0 else 1 end,
           last_received_at = greatest(last_received_at, p_received_at)
     where id = v_inbox_id;

    select cpj.id into v_job_id
      from control_plane_jobs cpj
     where cpj.inbox_id = v_inbox_id;

    return query select 'duplicate'::text, v_inbox_id, v_job_id;
    return;
  end if;

  insert into control_plane_jobs (
    id, inbox_id, job_type, payload_version, idempotency_key,
    priority, status, available_at, attempt_count, max_attempts, created_at
  ) values (
    p_job_id, v_inbox_id, 'github_webhook.lifecycle', 1,
    p_provider || ':' || p_delivery_id,
    case
      when p_event_type = 'installation'
       and p_event_action in ('deleted', 'suspend') then 10
      when p_event_type = 'installation_repositories'
       and p_event_action = 'removed' then 10
      when p_event_type = 'pull_request' then 50
      else 100
    end,
    'available', p_received_at, 0, p_max_attempts, p_received_at
  )
  returning id into v_job_id;

  return query select 'accepted'::text, v_inbox_id, v_job_id;
end;
$$;


update control_plane_jobs cpj
   set priority = case
     when wi.event_type = 'installation'
      and wi.event_action in ('deleted', 'suspend') then 10
     when wi.event_type = 'installation_repositories'
      and wi.event_action = 'removed' then 10
     when wi.event_type = 'pull_request' then 50
     else 100
   end
  from webhook_inbox wi
 where wi.id = cpj.inbox_id
   and cpj.status = 'available'
   and cpj.priority = 100
   and (
     wi.event_type = 'pull_request'
     or (wi.event_type = 'installation' and wi.event_action in ('deleted', 'suspend'))
     or (wi.event_type = 'installation_repositories' and wi.event_action = 'removed')
   );

insert into cloud_schema_migrations (version)
values ('0131_customer_webhook_queue_priority')
on conflict (version) do nothing;
