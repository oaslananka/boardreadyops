import { randomUUID } from "node:crypto";
import type {
  NotificationChannelKind,
  NotificationEvent,
  NotificationEventType,
} from "@boardreadyops/cloud-core/notifications";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

/**
 * Notification channels and the delivery outbox that feeds them.
 *
 * Deliveries are leased and retried rather than posted inline, for the same reason every other
 * outbound effect in this control plane is: a Slack workspace that is rate-limiting must not be
 * able to stall the supply-watch pass or the release run that produced the news.
 */

export type NotificationChannelRecord = {
  id: string;
  installationId: string;
  kind: NotificationChannelKind;
  /** The raw destination. Never send this to a client; mask it first. */
  destination: string;
  label: string;
  subscribedEvents: readonly NotificationEventType[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastDeliveredAt: string | undefined;
  lastError: string | undefined;
  lastErrorAt: string | undefined;
};

export type ClaimedNotificationDelivery = {
  id: string;
  channelId: string;
  kind: NotificationChannelKind;
  destination: string;
  eventType: NotificationEventType;
  event: NotificationEvent;
  attemptCount: number;
};

/** A time-bound risk acceptance that is close to lapsing. */
export type ExpiringWaiver = {
  decisionId: string;
  installationId: string;
  repositoryFullName: string;
  reviewId: string;
  pullRequestNumber: number | undefined;
  findingFingerprint: string;
  owner: string;
  reason: string;
  expiresAt: string;
};

/** A review that has been sitting in `awaiting_decision` without anyone deciding. */
export type StalledReview = {
  reviewId: string;
  installationId: string;
  repositoryFullName: string;
  pullRequestNumber: number | undefined;
  title: string;
  createdBy: string;
  awaitingSince: string;
};

export type NotificationStore = {
  listChannels(installationId: string): Promise<NotificationChannelRecord[]>;
  createChannel(input: {
    installationId: string;
    kind: NotificationChannelKind;
    destination: string;
    label: string;
    subscribedEvents: readonly NotificationEventType[];
    createdBy: string;
  }): Promise<{ outcome: "created" | "duplicate"; channel?: NotificationChannelRecord }>;
  updateChannel(input: {
    installationId: string;
    channelId: string;
    subscribedEvents?: readonly NotificationEventType[];
    enabled?: boolean;
    label?: string;
  }): Promise<"not_found" | "updated">;
  deleteChannel(input: { installationId: string; channelId: string }): Promise<"deleted" | "not_found">;
  /**
   * Queues one event to every channel in its installation that subscribes to it.
   *
   * Returns how many deliveries were created; a repeat of the same event returns 0 because the
   * `(channel_id, dedupe_key)` unique index absorbs it.
   */
  enqueueEvent(event: NotificationEvent): Promise<number>;
  /**
   * Accepted-risk waivers whose expiry falls inside the window.
   *
   * Only the newest decision per finding counts: a waiver that was later superseded by a
   * different disposition is not expiring, it is gone. Restricted to installations that have at
   * least one enabled channel, so a deployment with no channels does no work here at all.
   */
  listExpiringWaivers(input: { now: Date; withinMs: number; limit?: number }): Promise<ExpiringWaiver[]>;
  /** Reviews awaiting a decision for longer than `olderThanMs`. */
  listStalledReviews(input: { now: Date; olderThanMs: number; limit?: number }): Promise<StalledReview[]>;
  claimDeliveries(input: { workerId: string; limit?: number; now?: Date }): Promise<ClaimedNotificationDelivery[]>;
  completeDelivery(input: { deliveryId: string }): Promise<void>;
  failDelivery(input: { deliveryId: string; reason: string; permanent: boolean; now?: Date }): Promise<void>;
};

export type NotificationStoreOptions = {
  now?: () => Date;
  id?: () => string;
  /** Attempts before a delivery is dead-lettered. */
  maximumAttempts?: number;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
};

function rows(result: SqlQueryResult | unknown): readonly Record<string, unknown>[] {
  return (result as { rows?: readonly Record<string, unknown>[] })?.rows ?? [];
}

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

/** Kinds this schema accepts; anything else is a row written by a newer version of the app. */
function isChannelKind(value: string | undefined): value is NotificationChannelKind {
  return value === "email" || value === "slack" || value === "webhook";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function toChannel(row: Record<string, unknown>): NotificationChannelRecord | undefined {
  const id = text(row, "id");
  const installationId = text(row, "installation_id");
  const kind = text(row, "kind");
  const destination = text(row, "destination");
  if (!id || !installationId || !destination || !isChannelKind(kind)) return undefined;
  return {
    id,
    installationId,
    kind,
    destination,
    label: text(row, "label") ?? "Notification channel",
    subscribedEvents: stringArray(row.subscribed_events) as NotificationEventType[],
    enabled: row.enabled !== false,
    createdBy: text(row, "created_by") ?? "unknown",
    createdAt: text(row, "created_at") ?? "",
    lastDeliveredAt: text(row, "last_delivered_at"),
    lastError: text(row, "last_error"),
    lastErrorAt: text(row, "last_error_at"),
  };
}

export function createSqlNotificationStore(
  executor: SqlQueryExecutor,
  options: NotificationStoreOptions = {},
): NotificationStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const maximumAttempts = options.maximumAttempts ?? 6;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const retryBaseSeconds = options.retryBaseSeconds ?? 30;

  return {
    async listChannels(installationId) {
      const result = await executor.query(
        `select * from notification_channels
          where installation_id = $1
          order by created_at desc, id`,
        [installationId],
      );
      return rows(result).flatMap((row) => {
        const channel = toChannel(row);
        return channel ? [channel] : [];
      });
    },

    async createChannel(input) {
      const result = await executor.query(
        `insert into notification_channels
           (id, installation_id, kind, destination, label, subscribed_events, created_by)
         values ($1, $2, $3, $4, $5, $6::text[], $7)
         on conflict (installation_id, destination) do nothing
         returning *`,
        [
          id(),
          input.installationId,
          input.kind,
          input.destination,
          input.label,
          [...input.subscribedEvents],
          input.createdBy,
        ],
      );
      const row = rows(result)[0];
      if (!row) return { outcome: "duplicate" };
      const channel = toChannel(row);
      return channel ? { outcome: "created", channel } : { outcome: "duplicate" };
    },

    async updateChannel(input) {
      const result = await executor.query(
        `update notification_channels
            set subscribed_events = coalesce($3::text[], subscribed_events),
                enabled = coalesce($4::boolean, enabled),
                label = coalesce($5::text, label),
                updated_at = now()
          where id = $1 and installation_id = $2
          returning id`,
        [
          input.channelId,
          input.installationId,
          input.subscribedEvents ? [...input.subscribedEvents] : null,
          input.enabled ?? null,
          input.label ?? null,
        ],
      );
      return rows(result).length > 0 ? "updated" : "not_found";
    },

    async deleteChannel(input) {
      const result = await executor.query(
        `delete from notification_channels where id = $1 and installation_id = $2 returning id`,
        [input.channelId, input.installationId],
      );
      return rows(result).length > 0 ? "deleted" : "not_found";
    },

    async enqueueEvent(event) {
      // One statement rather than a read followed by writes: the fan-out and the duplicate
      // suppression then happen under the same snapshot, so two workers reporting the same
      // finding cannot both decide the delivery does not exist yet.
      const result = await executor.query(
        `insert into notification_deliveries (id, channel_id, event_type, dedupe_key, payload)
         select gen_random_uuid()::text, channels.id, $2, $3, $4::jsonb
           from notification_channels as channels
          where channels.installation_id = $1
            and channels.enabled
            and $2 = any(channels.subscribed_events)
         on conflict (channel_id, dedupe_key) do nothing
         returning id`,
        [event.installationId, event.type, event.dedupeKey, JSON.stringify(event)],
      );
      return rows(result).length;
    },

    async listExpiringWaivers(input) {
      const horizon = new Date(input.now.valueOf() + input.withinMs);
      const result = await executor.query(
        `with latest as (
           select distinct on (decisions.review_id, decisions.finding_fingerprint)
                  decisions.id,
                  decisions.review_id,
                  decisions.finding_fingerprint,
                  decisions.disposition,
                  decisions.owner,
                  decisions.reason,
                  decisions.expires_at
             from finding_decisions as decisions
            where decisions.expires_at is not null
            order by decisions.review_id, decisions.finding_fingerprint, decisions.created_at desc
         )
         select latest.id,
                latest.review_id,
                latest.finding_fingerprint,
                latest.owner,
                latest.reason,
                latest.expires_at,
                reviews.pull_request_number,
                repositories.installation_id,
                repositories.owner as repository_owner,
                repositories.name as repository_name
           from latest
           join reviews on reviews.id = latest.review_id
           join repositories on repositories.id = reviews.repository_id
          where latest.disposition = 'accepted_risk'
            and latest.expires_at > $1::timestamptz
            and latest.expires_at <= $2::timestamptz
            and exists (
              select 1 from notification_channels as channels
               where channels.installation_id = repositories.installation_id and channels.enabled
            )
          order by latest.expires_at
          limit $3`,
        [input.now.toISOString(), horizon.toISOString(), input.limit ?? 100],
      );

      return rows(result).flatMap((row): ExpiringWaiver[] => {
        const decisionId = text(row, "id");
        const installationId = text(row, "installation_id");
        const reviewId = text(row, "review_id");
        const expiresAt = text(row, "expires_at");
        const owner = text(row, "repository_owner");
        const name = text(row, "repository_name");
        if (!decisionId || !installationId || !reviewId || !expiresAt || !owner || !name) return [];
        const pullRequestNumber = Number(row.pull_request_number);
        return [
          {
            decisionId,
            installationId,
            repositoryFullName: `${owner}/${name}`,
            reviewId,
            pullRequestNumber: Number.isSafeInteger(pullRequestNumber) ? pullRequestNumber : undefined,
            findingFingerprint: text(row, "finding_fingerprint") ?? "",
            owner: text(row, "owner") ?? "unknown",
            reason: text(row, "reason") ?? "",
            expiresAt,
          },
        ];
      });
    },

    async listStalledReviews(input) {
      const threshold = new Date(input.now.valueOf() - input.olderThanMs);
      const result = await executor.query(
        `select reviews.id,
                reviews.pull_request_number,
                reviews.title,
                reviews.created_by,
                reviews.updated_at,
                repositories.installation_id,
                repositories.owner as repository_owner,
                repositories.name as repository_name
           from reviews
           join repositories on repositories.id = reviews.repository_id
          where reviews.status = 'awaiting_decision'
            and reviews.decision = 'pending'
            and reviews.updated_at <= $1::timestamptz
            and exists (
              select 1 from notification_channels as channels
               where channels.installation_id = repositories.installation_id and channels.enabled
            )
          order by reviews.updated_at
          limit $2`,
        [threshold.toISOString(), input.limit ?? 100],
      );

      return rows(result).flatMap((row): StalledReview[] => {
        const reviewId = text(row, "id");
        const installationId = text(row, "installation_id");
        const owner = text(row, "repository_owner");
        const name = text(row, "repository_name");
        const awaitingSince = text(row, "updated_at");
        if (!reviewId || !installationId || !owner || !name || !awaitingSince) return [];
        const pullRequestNumber = Number(row.pull_request_number);
        return [
          {
            reviewId,
            installationId,
            repositoryFullName: `${owner}/${name}`,
            pullRequestNumber: Number.isSafeInteger(pullRequestNumber) ? pullRequestNumber : undefined,
            title: text(row, "title") ?? "Hardware review",
            createdBy: text(row, "created_by") ?? "unknown",
            awaitingSince,
          },
        ];
      });
    },

    async claimDeliveries(input) {
      const at = input.now ?? now();
      const leaseExpiresAt = new Date(at.valueOf() + leaseSeconds * 1000);
      const result = await executor.query(
        `with claimed as (
           select deliveries.id
             from notification_deliveries as deliveries
             join notification_channels as channels on channels.id = deliveries.channel_id
            where deliveries.status in ('pending','delivering')
              and deliveries.next_attempt_at <= $1::timestamptz
              and (deliveries.lease_expires_at is null or deliveries.lease_expires_at <= $1::timestamptz)
              and channels.enabled
            order by deliveries.next_attempt_at
            limit $2
            -- Skip rather than wait: another worker holding a row is not a reason to block.
            for update of deliveries skip locked
         )
         update notification_deliveries as deliveries
            set status = 'delivering',
                attempt_count = deliveries.attempt_count + 1,
                lease_expires_at = $3::timestamptz
           from claimed, notification_channels as channels
          where deliveries.id = claimed.id
            and channels.id = deliveries.channel_id
          returning deliveries.id,
                    deliveries.channel_id,
                    deliveries.event_type,
                    deliveries.payload,
                    deliveries.attempt_count,
                    channels.kind,
                    channels.destination`,
        [at.toISOString(), input.limit ?? 20, leaseExpiresAt.toISOString()],
      );

      return rows(result).flatMap((row): ClaimedNotificationDelivery[] => {
        const deliveryId = text(row, "id");
        const channelId = text(row, "channel_id");
        const destination = text(row, "destination");
        const kind = text(row, "kind");
        const eventType = text(row, "event_type");
        const payload = row.payload;
        if (!deliveryId || !channelId || !destination || !eventType || !isChannelKind(kind)) return [];
        const event = typeof payload === "string" ? safeParse(payload) : (payload as NotificationEvent | undefined);
        if (!event) return [];
        const attemptCount = Number(row.attempt_count);
        return [
          {
            id: deliveryId,
            channelId,
            kind,
            destination,
            eventType: eventType as NotificationEventType,
            event,
            attemptCount: Number.isFinite(attemptCount) ? attemptCount : 1,
          },
        ];
      });
    },

    async completeDelivery(input) {
      await executor.query(
        `with done as (
           update notification_deliveries
              set status = 'delivered', delivered_at = now(), lease_expires_at = null, last_error = null
            where id = $1
            returning channel_id
         )
         update notification_channels
            set last_delivered_at = now(), last_error = null, last_error_at = null
          from done
         where notification_channels.id = done.channel_id`,
        [input.deliveryId],
      );
    },

    async failDelivery(input) {
      const at = input.now ?? now();
      // Exponential backoff on the attempt already recorded by the claim.
      const nextAttemptAt = new Date(at.valueOf() + retryBaseSeconds * 1000);
      await executor.query(
        `with failed as (
           update notification_deliveries
              set status = case
                             when $3::boolean then 'dead_letter'
                             when attempt_count >= $4 then 'dead_letter'
                             else 'pending'
                           end,
                  last_error = $2,
                  lease_expires_at = null,
                  next_attempt_at = $5::timestamptz
                    + (least(attempt_count, 6) * interval '1 second' * $6)
            where id = $1
            returning channel_id
         )
         update notification_channels
            set last_error = $2, last_error_at = now()
          from failed
         where notification_channels.id = failed.channel_id`,
        [
          input.deliveryId,
          input.reason.slice(0, 500),
          input.permanent,
          maximumAttempts,
          nextAttemptAt.toISOString(),
          retryBaseSeconds,
        ],
      );
    },
  };
}

function safeParse(value: string): NotificationEvent | undefined {
  try {
    return JSON.parse(value) as NotificationEvent;
  } catch {
    return undefined;
  }
}
