export type BillingMode = "marketplace_free" | "stripe" | "both";

/**
 * Which billing surface `/api/v1/billing/checkout` and `/portal` serve.
 *
 * Defaults to `marketplace_free` -- today's behavior (HTTP 410, GitHub Marketplace is the only
 * paid path) -- so leaving `BILLING_MODE` unset changes nothing. Setting it to `stripe` or
 * `both` is a deliberate operator decision to open the self-serve Stripe checkout/portal
 * endpoints; `both` keeps Marketplace as a parallel free discovery tier.
 */
export function resolveBillingMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BillingMode {
  const raw = environment.BILLING_MODE?.trim().toLowerCase();
  if (raw === "stripe" || raw === "both") return raw;
  return "marketplace_free";
}
