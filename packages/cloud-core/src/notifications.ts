/**
 * Outbound notifications for the control plane.
 *
 * The cloud product had no way to tell anyone anything. `supply-watch` detected a part going
 * end-of-life and wrote a row; a release run blocked a board and wrote a row; a waiver expired
 * and wrote a row. Nobody was told, so the only way to learn any of it was to open the dashboard
 * and go looking — which means the product only ever reached people who were already thinking
 * about it. (The CLI has had Slack and email notifiers since early on, under `src/notifiers/`,
 * but those run on the developer's machine and know nothing about an installation.)
 *
 * This module is the pure half: the event vocabulary, the rendering, and the transport contract.
 * Persistence lives in `@boardreadyops/db/notification-store` and the drain loop in the web
 * app's worker, so that the same retry, lease, and dead-letter machinery the rest of the control
 * plane uses applies here too rather than a second, weaker delivery path.
 */

export type NotificationEventType =
  | "release.blocked"
  | "release.ready"
  | "review.decision_requested"
  | "supply.risk_detected"
  | "waiver.expiring";

export type NotificationChannelKind = "email" | "slack" | "webhook";

export type NotificationEventDefinition = {
  type: NotificationEventType;
  label: string;
  /** What the recipient is being told, written for the settings screen. */
  description: string;
  /** Default for a newly created channel. */
  defaultOn: boolean;
};

/**
 * The events a channel can subscribe to.
 *
 * Deliberately small and all high-signal: a notification channel that fires on everything gets
 * muted, and a muted channel is the same as no channel.
 */
export const notificationEventCatalog: readonly NotificationEventDefinition[] = [
  {
    type: "release.blocked",
    label: "A board is blocked from fabrication",
    description: "A release run finished with blocking findings, so the board cannot be sent to a fabricator.",
    defaultOn: true,
  },
  {
    type: "supply.risk_detected",
    label: "A part went end-of-life or NRND",
    description:
      "Continuous supply watch found a component on a watched board that is no longer safe to design in. This is the one that arrives months before it would otherwise hurt.",
    defaultOn: true,
  },
  {
    type: "waiver.expiring",
    label: "A waiver is about to expire",
    description: "A time-bound risk acceptance is close to lapsing and will start blocking releases again.",
    defaultOn: true,
  },
  {
    type: "review.decision_requested",
    label: "A review needs my decision",
    description: "Someone requested a sign-off, or a review has been waiting on a decision.",
    defaultOn: false,
  },
  {
    type: "release.ready",
    label: "A board became ready to fabricate",
    description: "A release run passed every gate and its evidence was sealed.",
    defaultOn: false,
  },
];

export function isNotificationEventType(value: unknown): value is NotificationEventType {
  return typeof value === "string" && notificationEventCatalog.some((entry) => entry.type === value);
}

export function defaultSubscribedEvents(): readonly NotificationEventType[] {
  return notificationEventCatalog.filter((entry) => entry.defaultOn).map((entry) => entry.type);
}

export type NotificationEvent = {
  type: NotificationEventType;
  installationId: string;
  /** Human repository identity, e.g. `acme/gateway`. */
  repositoryFullName: string;
  /** One line stating what happened. Already safe to render as plain text. */
  headline: string;
  /** Supporting facts, rendered as a short list. Keep each under ~100 characters. */
  details: readonly string[];
  /** Absolute URL to the page that answers "what do I do about it". */
  url?: string | undefined;
  /**
   * Stable identity for this event. Two notifications with the same key are the same news, so
   * the store refuses the second one — a supply watch pass that reruns must not re-announce
   * every part it already announced.
   */
  dedupeKey: string;
  occurredAt: string;
};

export type RenderedNotification = {
  /** Subject line or fallback text. */
  text: string;
  /** The JSON body to POST. Shaped per channel kind. */
  body: unknown;
};

const maximumDetails = 8;
const maximumDetailLength = 200;

function boundedDetails(details: readonly string[]): readonly string[] {
  return details.slice(0, maximumDetails).map((detail) => detail.slice(0, maximumDetailLength));
}

/**
 * Escapes the characters Slack's mrkdwn treats as markup.
 *
 * Repository names, rule ids, and part numbers all reach this from outside, and a notification
 * is a place where injected markup would be rendered for a whole team.
 */
export function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderNotification(event: NotificationEvent, kind: NotificationChannelKind): RenderedNotification {
  const details = boundedDetails(event.details);
  const text = `${event.repositoryFullName}: ${event.headline}`;

  if (kind === "slack") {
    const lines = [`*${escapeSlackText(text)}*`, ...details.map((detail) => `• ${escapeSlackText(detail)}`)];
    if (event.url) lines.push(`<${event.url}|Open in BoardReadyOps>`);
    return {
      text,
      body: {
        text: escapeSlackText(text),
        blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
      },
    };
  }

  if (kind === "email") {
    // Plain text, not HTML: a notification is read in a preview pane as often as it is opened,
    // and every mail client renders text consistently. The subject carries the whole headline
    // so the message is actionable without being opened at all.
    const lines = [text, "", ...details.map((detail) => `- ${detail}`)];
    if (event.url) lines.push("", event.url);
    return { text, body: { subject: text, text: lines.join("\n") } };
  }

  // A generic webhook receives the event rather than a rendering of it: the receiver is a
  // program, and giving it prose to parse would be the wrong contract.
  return {
    text,
    body: {
      type: event.type,
      installationId: event.installationId,
      repository: event.repositoryFullName,
      headline: event.headline,
      details,
      ...(event.url ? { url: event.url } : {}),
      occurredAt: event.occurredAt,
    },
  };
}

export type NotificationTransportResult =
  | { outcome: "delivered" }
  /** The destination rejected the message in a way retrying will not fix. */
  | { outcome: "permanent_failure"; reason: string }
  /** A transient failure: rate limit, timeout, 5xx. */
  | { outcome: "retryable_failure"; reason: string };

export type NotificationTransport = {
  deliver(input: {
    kind: NotificationChannelKind;
    destination: string;
    rendered: RenderedNotification;
  }): Promise<NotificationTransportResult>;
};

export type HttpNotificationTransportDependencies = {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
};

/** Status codes that mean "this destination will never accept this", so retrying is pointless. */
function permanent(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410;
}

export function createHttpNotificationTransport(
  dependencies: HttpNotificationTransportDependencies,
): NotificationTransport {
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  return {
    async deliver({ destination, rendered }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await dependencies.fetch(destination, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(rendered.body),
          signal: controller.signal,
        });
        if (response.ok) return { outcome: "delivered" };
        return permanent(response.status)
          ? { outcome: "permanent_failure", reason: `destination responded ${response.status}` }
          : { outcome: "retryable_failure", reason: `destination responded ${response.status}` };
      } catch (error) {
        // A timeout, DNS failure, or reset: all worth another attempt.
        return {
          outcome: "retryable_failure",
          reason: error instanceof Error ? error.message.slice(0, 200) : "request failed",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type EmailNotificationBody = { subject: string; text: string };

export type SmtpNotificationTransportDependencies = {
  /** `smtp://` or `smtps://`, with credentials in the URL when the relay needs them. */
  smtpUrl: string;
  /** Envelope sender. Relays reject mail from an address they do not recognise. */
  from: string;
  sendEmail: (smtpUrl: string, message: { from: string; to: string[]; subject: string; text: string }) => Promise<void>;
};

/** SMTP failure codes that mean the address will never accept this, so retrying is pointless. */
function permanentSmtpFailure(message: string): boolean {
  // `sendSmtpEmail` reports a refusal as `SMTP <code>`. 5xx is a permanent refusal by definition;
  // 4xx is the relay asking to be tried again later.
  const code = Number(/^SMTP (\d{3})$/u.exec(message.trim())?.[1]);
  return Number.isFinite(code) && code >= 500 && code < 600;
}

/**
 * Delivers an email notification through an SMTP relay.
 *
 * Only constructed when a deployment has configured a relay. Without one the email channel kind
 * is never offered in the UI and never accepted by the API, because a channel that silently
 * cannot deliver is worse than an absent one.
 */
export function createSmtpNotificationTransport(
  dependencies: SmtpNotificationTransportDependencies,
): NotificationTransport {
  return {
    async deliver({ destination, rendered }) {
      const body = rendered.body as Partial<EmailNotificationBody>;
      if (typeof body?.subject !== "string" || typeof body.text !== "string") {
        return { outcome: "permanent_failure", reason: "notification could not be rendered as an email" };
      }
      try {
        await dependencies.sendEmail(dependencies.smtpUrl, {
          from: dependencies.from,
          to: [destination],
          subject: body.subject,
          text: body.text,
        });
        return { outcome: "delivered" };
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : "SMTP delivery failed";
        return permanentSmtpFailure(reason)
          ? { outcome: "permanent_failure", reason }
          : { outcome: "retryable_failure", reason };
      }
    },
  };
}

/**
 * Routes each channel kind to the transport that can serve it.
 *
 * `email` resolves to a refusal rather than an exception when no relay is configured, so an
 * existing email channel on a deployment that later drops its SMTP settings dead-letters with an
 * explanation the channel owner can read instead of crashing the delivery pass.
 */
export function createCompositeNotificationTransport(transports: {
  http: NotificationTransport;
  smtp?: NotificationTransport | undefined;
}): NotificationTransport {
  return {
    async deliver(input) {
      if (input.kind !== "email") return transports.http.deliver(input);
      if (!transports.smtp) {
        return {
          outcome: "permanent_failure",
          reason: "this deployment has no SMTP relay configured, so email cannot be delivered",
        };
      }
      return transports.smtp.deliver(input);
    },
  };
}

/**
 * Whether a destination is acceptable for a channel of this kind.
 *
 * A notification destination is a URL the control plane will POST to on a schedule it controls,
 * which makes an unvalidated one a server-side request forgery primitive. HTTPS only, no
 * credentials in the URL, and a Slack channel must actually point at Slack.
 */
export function validateNotificationDestination(
  kind: NotificationChannelKind,
  destination: string,
): { ok: true } | { ok: false; reason: string } {
  if (kind === "email") return validateEmailDestination(destination);

  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return { ok: false, reason: "Enter a full URL, including https://" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "The URL must use https://" };
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the username or password from the URL; it would be stored and logged" };
  }
  if (kind === "slack" && url.hostname !== "hooks.slack.com") {
    return { ok: false, reason: "A Slack channel must use an https://hooks.slack.com/... incoming webhook URL" };
  }
  if (kind === "webhook" && isLikelyInternalHost(url.hostname)) {
    return { ok: false, reason: "That host is not reachable from the control plane" };
  }
  return { ok: true };
}

/**
 * Accepts one ordinary address.
 *
 * Deliberately one recipient per channel rather than a list: a channel is a destination, and
 * "who else should get this" is a question for the mail system's own aliases and distribution
 * lists, which already handle joiners and leavers. Storing a list here would mean BoardReadyOps
 * owning a directory it has no way to keep correct.
 */
function validateEmailDestination(destination: string): { ok: true } | { ok: false; reason: string } {
  const address = destination.trim();
  if (address.length > 254) return { ok: false, reason: "That address is too long" };
  if (/[\s,;<>]/u.test(address)) {
    return { ok: false, reason: "Enter one plain address, with no name, angle brackets, or separators" };
  }
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1)
    return { ok: false, reason: "Enter an address of the form name@example.com" };
  const domain = address.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return { ok: false, reason: "The address needs a full domain, such as name@example.com" };
  }
  return { ok: true };
}

/**
 * Blocks the obvious internal targets by name.
 *
 * Not a complete SSRF defence on its own — DNS can still resolve a public name inwards — but it
 * refuses the direct attempts at the point where a person would notice the mistake. The deploy
 * environment's egress rules remain the real boundary.
 */
function isLikelyInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  if (host === "metadata.google.internal" || host === "169.254.169.254") return true;
  if (/^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./u.test(host)) return true;
  return host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

/** A destination safe to show back to a viewer: enough to recognise, not enough to reuse. */
export function maskNotificationDestination(destination: string): string {
  // An address is not a credential the way a webhook URL is, but it is personal data, so the
  // local part is still reduced rather than printed in a page anyone on the team can open.
  const at = destination.lastIndexOf("@");
  if (at > 0 && !destination.includes("://")) {
    const local = destination.slice(0, at);
    const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
    return `${shown}${"•".repeat(Math.max(1, local.length - shown.length))}@${destination.slice(at + 1)}`;
  }
  try {
    const url = new URL(destination);
    const segments = url.pathname.split("/").filter(Boolean);
    const tail = segments.at(-1);
    const masked = tail && tail.length > 4 ? `…${tail.slice(-4)}` : "…";
    return `${url.origin}/${segments.slice(0, -1).join("/")}${segments.length > 1 ? "/" : ""}${masked}`;
  } catch {
    return "…";
  }
}
