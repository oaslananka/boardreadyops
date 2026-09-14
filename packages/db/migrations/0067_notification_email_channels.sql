-- Allow an email notification channel alongside Slack and generic webhooks.
--
-- Split from 0066 rather than folded into it: 0066 has shipped, and rewriting an applied
-- migration would leave deployments that already ran it with a constraint the repository no
-- longer describes.
--
-- The destination column holds an address rather than a URL for this kind. It stays a single
-- opaque text column because the only thing the control plane does with it is hand it to the
-- transport that understands that kind.

ALTER TABLE notification_channels
  DROP CONSTRAINT IF EXISTS notification_channels_kind_check;

ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_kind_check
  CHECK (kind IN ('email', 'slack', 'webhook'));
