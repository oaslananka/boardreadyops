/**
 * The SQL that decides whether an installation's data may be read at all.
 *
 * Eleven queries across nine modules had written this out by hand, byte for byte. That is fine
 * until the rule changes -- a new subscription status, a second way to suspend -- because then it
 * has to change in eleven places, and the one that gets missed is a query that keeps serving a
 * tenant who is no longer entitled to be served. A leak by omission is the worst kind to review
 * for, since the diff that causes it is the absence of a change.
 *
 * So the fragment lives here once, and `tests/unit/web/tenant-scope.test.ts` fails if a query
 * inlines its own copy again.
 */

/**
 * Excludes installations whose Marketplace subscription has been cancelled.
 *
 * Requires `installations` to be in scope under that name. The account-login arm covers
 * subscriptions recorded before the installation existed, which carry no installation id.
 *
 * Note this is only half of the rule: every caller also needs `installations.suspended_at is null`
 * (and, where it joins repositories, `repositories.disabled_at is null`). Those are single
 * predicates that read clearly at the call site, and folding them in here would hide from a
 * reviewer which tables a query is actually filtering.
 */
export const notCancelledSubscription = `not exists (
       select 1
         from github_marketplace_subscriptions
        where github_marketplace_subscriptions.status = 'canceled'
          and (
            github_marketplace_subscriptions.github_installation_id = installations.github_installation_id
            or (
              github_marketplace_subscriptions.github_installation_id is null
              and lower(github_marketplace_subscriptions.account_login) = lower(installations.account_login)
            )
          )
     )`;

/**
 * The same rule, asked as a standalone question.
 *
 * `server-review-loader.ts` has already fetched the installation row by the time it needs the
 * answer, so it cannot use a predicate that correlates against `installations`. It passes the
 * GitHub installation id as `$1` and the account login as `$2`; a returned row means cancelled.
 *
 * The two forms are deliberately adjacent. They encode one rule, and the only way to keep them
 * agreeing is for a change to either to be a change in this file, where the other is on screen.
 */
export const cancelledSubscriptionProbe = `select 1
       from github_marketplace_subscriptions
      where github_marketplace_subscriptions.status = 'canceled'
        and (
          github_marketplace_subscriptions.github_installation_id = $1
          or (
            github_marketplace_subscriptions.github_installation_id is null
            and lower(github_marketplace_subscriptions.account_login) = lower($2)
          )
        )
      limit 1`;
