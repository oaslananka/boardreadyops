/**
 * The SMTP client moved to `@boardreadyops/cloud-core` when the control plane grew an email
 * notification channel: one implementation, two callers, rather than a copy in each.
 *
 * Re-exported here because the CLI's notifier layer, its configuration types, and its tests all
 * address it at this path.
 */
export { type EmailMessage, type EmailSender, sendSmtpEmail } from "@boardreadyops/cloud-core/smtp";
