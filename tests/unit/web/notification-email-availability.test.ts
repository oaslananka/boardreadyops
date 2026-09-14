import { describe, expect, it } from "vitest";
import {
  configuredEmailNotificationSettings,
  emailNotificationsAvailable,
} from "../../../apps/web/lib/notification-worker.js";

/**
 * Email is offered only where it can actually be delivered.
 *
 * Half a configuration counts as none: a relay with no envelope sender is rejected by most
 * providers, and finding that out at delivery time — after someone has added a channel and
 * assumed they are covered — is the failure this gate exists to prevent.
 */
describe("email notification availability", () => {
  const relay = "smtps://user:pass@relay.example.com:465";
  const from = "boardreadyops@example.com";

  it("is available only when both the relay and the sender are set", () => {
    expect(emailNotificationsAvailable({ BOARDREADYOPS_NOTIFICATION_SMTP_URL: relay })).toBe(false);
    expect(emailNotificationsAvailable({ BOARDREADYOPS_NOTIFICATION_EMAIL_FROM: from })).toBe(false);
    expect(emailNotificationsAvailable({})).toBe(false);
    expect(
      emailNotificationsAvailable({
        BOARDREADYOPS_NOTIFICATION_SMTP_URL: relay,
        BOARDREADYOPS_NOTIFICATION_EMAIL_FROM: from,
      }),
    ).toBe(true);
  });

  it("treats whitespace-only configuration as absent", () => {
    expect(
      emailNotificationsAvailable({
        BOARDREADYOPS_NOTIFICATION_SMTP_URL: "   ",
        BOARDREADYOPS_NOTIFICATION_EMAIL_FROM: "  ",
      }),
    ).toBe(false);
  });

  it("refuses a relay URL that is not SMTP, rather than handing it to the client", () => {
    for (const url of ["https://relay.example.com", "relay.example.com:465", "ftp://relay.example.com"]) {
      expect(
        emailNotificationsAvailable({
          BOARDREADYOPS_NOTIFICATION_SMTP_URL: url,
          BOARDREADYOPS_NOTIFICATION_EMAIL_FROM: from,
        }),
        url,
      ).toBe(false);
    }
  });

  it("returns the trimmed settings the transport needs", () => {
    expect(
      configuredEmailNotificationSettings({
        BOARDREADYOPS_NOTIFICATION_SMTP_URL: ` ${relay} `,
        BOARDREADYOPS_NOTIFICATION_EMAIL_FROM: ` ${from} `,
      }),
    ).toEqual({ smtpUrl: relay, from });
    expect(configuredEmailNotificationSettings({})).toBeUndefined();
  });
});
