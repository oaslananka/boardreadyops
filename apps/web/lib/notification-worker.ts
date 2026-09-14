import {
  createCompositeNotificationTransport,
  createHttpNotificationTransport,
  createSmtpNotificationTransport,
  type NotificationEvent,
  type NotificationTransport,
  renderNotification,
} from "@boardreadyops/cloud-core/notifications";
import { sendSmtpEmail } from "@boardreadyops/cloud-core/smtp";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import {
  createSqlNotificationStore,
  type ExpiringWaiver,
  type NotificationStore,
  type StalledReview,
} from "@boardreadyops/db/notification-store";

/**
 * Drains the notification outbox.
 *
 * Shaped like the other control-plane workers in this directory — claim a bounded batch under a
 * lease, act, then record the outcome — so it can be driven from the same worker runtime and so
 * a destination that is down produces a retry and finally a dead letter rather than a lost
 * notification or a wedged pass.
 */

export type NotificationWorkerDependencies = {
  store: NotificationStore;
  transport: NotificationTransport;
  workerId: string;
  batchSize?: number;
};

export type NotificationWorkerResult = {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
};

/**
 * The SMTP relay this deployment sends notification email through, when it has one.
 *
 * Returns undefined unless both a relay URL and an envelope sender are configured. Half a
 * configuration is treated as none: a relay with no `From` is rejected by most providers, and
 * failing at delivery time would be a worse way to discover that than not offering email at all.
 */
export function configuredEmailNotificationSettings(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { smtpUrl: string; from: string } | undefined {
  const smtpUrl = environment.BOARDREADYOPS_NOTIFICATION_SMTP_URL?.trim();
  const from = environment.BOARDREADYOPS_NOTIFICATION_EMAIL_FROM?.trim();
  if (!smtpUrl || !from) return undefined;
  if (!smtpUrl.startsWith("smtp://") && !smtpUrl.startsWith("smtps://")) return undefined;
  return { smtpUrl, from };
}

/** Whether this deployment can offer an email channel at all. */
export function emailNotificationsAvailable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return configuredEmailNotificationSettings(environment) !== undefined;
}

export function createNotificationWorkerDependencies(
  executor: SqlQueryExecutor,
  workerId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): NotificationWorkerDependencies {
  const email = configuredEmailNotificationSettings(environment);
  return {
    store: createSqlNotificationStore(executor),
    transport: createCompositeNotificationTransport({
      http: createHttpNotificationTransport({ fetch: globalThis.fetch }),
      ...(email ? { smtp: createSmtpNotificationTransport({ ...email, sendEmail: sendSmtpEmail }) } : {}),
    }),
    workerId,
  };
}

export async function runNotificationDeliveryPass(
  dependencies: NotificationWorkerDependencies,
): Promise<NotificationWorkerResult> {
  const batchSize = dependencies.batchSize ?? 20;
  const claimed = await dependencies.store.claimDeliveries({ workerId: dependencies.workerId, limit: batchSize });

  const result: NotificationWorkerResult = { claimed: claimed.length, delivered: 0, retried: 0, deadLettered: 0 };

  for (const delivery of claimed) {
    const rendered = renderNotification(delivery.event, delivery.kind);
    const outcome = await dependencies.transport.deliver({
      kind: delivery.kind,
      destination: delivery.destination,
      rendered,
    });

    if (outcome.outcome === "delivered") {
      await dependencies.store.completeDelivery({ deliveryId: delivery.id });
      result.delivered += 1;
      continue;
    }

    // A permanent failure is recorded once and never retried: a webhook whose Slack app was
    // uninstalled will answer 404 forever, and retrying it six times only delays the moment the
    // owner sees "last error" on the channel and fixes it.
    const permanent = outcome.outcome === "permanent_failure";
    await dependencies.store.failDelivery({ deliveryId: delivery.id, reason: outcome.reason, permanent });
    if (permanent) result.deadLettered += 1;
    else result.retried += 1;
  }

  return result;
}

/**
 * The two notifications nothing else can produce.
 *
 * A blocked release and an end-of-life part both have a moment that causes them — a run
 * finishing, a supply-watch pass — and are announced from there. These two have no such moment:
 * a waiver lapses and a review goes unanswered by the passage of time alone, which is exactly
 * why they are the ones a team misses.
 */

export type NotificationScanOptions = {
  /** How far ahead of expiry a waiver is worth mentioning. */
  waiverHorizonMs?: number;
  /** How long a review may sit awaiting a decision before it is worth mentioning. */
  reviewStallMs?: number;
  now?: Date;
  publicUrl?: string | undefined;
};

export type NotificationScanResult = {
  waiversQueued: number;
  reviewsQueued: number;
};

const defaultWaiverHorizonMs = 7 * 24 * 60 * 60 * 1000;
const defaultReviewStallMs = 2 * 24 * 60 * 60 * 1000;

function days(fromMs: number): string {
  const value = Math.max(0, Math.round(fromMs / (24 * 60 * 60 * 1000)));
  if (value === 0) return "today";
  return value === 1 ? "in 1 day" : `in ${value} days`;
}

export function expiringWaiverEvent(
  waiver: ExpiringWaiver,
  now: Date,
  publicUrl: string | undefined,
): NotificationEvent {
  const remaining = Date.parse(waiver.expiresAt) - now.valueOf();
  return {
    type: "waiver.expiring",
    installationId: waiver.installationId,
    repositoryFullName: waiver.repositoryFullName,
    headline: `A risk acceptance lapses ${days(remaining)} and will start blocking releases again`,
    details: [
      waiver.pullRequestNumber === undefined
        ? `Review ${waiver.reviewId}`
        : `Pull request #${waiver.pullRequestNumber}`,
      `Accepted by ${waiver.owner}: ${waiver.reason}`,
      `Expires ${waiver.expiresAt}`,
    ],
    ...(publicUrl ? { url: `${publicUrl}/reviews/${waiver.reviewId}` } : {}),
    // One announcement per waiver, not one per scan.
    dedupeKey: `waiver:${waiver.decisionId}`,
    occurredAt: now.toISOString(),
  };
}

export function stalledReviewEvent(review: StalledReview, now: Date, publicUrl: string | undefined): NotificationEvent {
  const waiting = now.valueOf() - Date.parse(review.awaitingSince);
  const waited = Math.max(1, Math.round(waiting / (24 * 60 * 60 * 1000)));
  return {
    type: "review.decision_requested",
    installationId: review.installationId,
    repositoryFullName: review.repositoryFullName,
    headline: `A review has been waiting ${waited} day${waited === 1 ? "" : "s"} for a decision`,
    details: [
      review.title,
      review.pullRequestNumber === undefined
        ? `Review ${review.reviewId}`
        : `Pull request #${review.pullRequestNumber}`,
      `Opened by ${review.createdBy}`,
    ],
    ...(publicUrl ? { url: `${publicUrl}/reviews/${review.reviewId}` } : {}),
    // Keyed on the day, so a review left alone for a week nudges once a day rather than on
    // every scan, and stops entirely once somebody decides.
    dedupeKey: `review-stalled:${review.reviewId}:${now.toISOString().slice(0, 10)}`,
    occurredAt: now.toISOString(),
  };
}

export async function runNotificationScanPass(
  dependencies: Pick<NotificationWorkerDependencies, "store">,
  options: NotificationScanOptions = {},
): Promise<NotificationScanResult> {
  const now = options.now ?? new Date();
  const publicUrl = options.publicUrl?.replace(/\/$/u, "");
  const result: NotificationScanResult = { waiversQueued: 0, reviewsQueued: 0 };

  const waivers = await dependencies.store.listExpiringWaivers({
    now,
    withinMs: options.waiverHorizonMs ?? defaultWaiverHorizonMs,
  });
  for (const waiver of waivers) {
    result.waiversQueued += await dependencies.store.enqueueEvent(expiringWaiverEvent(waiver, now, publicUrl));
  }

  const reviews = await dependencies.store.listStalledReviews({
    now,
    olderThanMs: options.reviewStallMs ?? defaultReviewStallMs,
  });
  for (const review of reviews) {
    result.reviewsQueued += await dependencies.store.enqueueEvent(stalledReviewEvent(review, now, publicUrl));
  }

  return result;
}
