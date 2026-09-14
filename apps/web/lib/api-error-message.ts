/**
 * Turns an API failure into something a viewer can act on.
 *
 * Client pages used to echo the response body straight into a red banner, so a signed-out
 * visitor on `/policies` was shown the literal string `authentication required` — lowercase,
 * with no indication that signing in would fix it. The status code already says what kind of
 * failure it is, so the wording is decided here once instead of at every call site.
 *
 * The server's own message is preferred when it is a sentence written for a person (it starts
 * with a capital letter and ends with a period); otherwise it is treated as an internal code and
 * replaced. That keeps deliberately-worded messages — the capability refusals, for instance —
 * while keeping developer shorthand off the screen.
 */

type ApiFailureAction = {
  label: string;
  href: string;
};

export type ApiFailure = {
  message: string;
  action?: ApiFailureAction;
};

const signIn: ApiFailureAction = { label: "Sign in with GitHub", href: "/api/auth/github/login" };

function looksWrittenForAPerson(message: string | undefined): message is string {
  if (!message) return false;
  const trimmed = message.trim();
  if (trimmed.length < 12) return false;
  const first = trimmed[0];
  return first !== undefined && first === first.toUpperCase() && /[.!?]$/u.test(trimmed);
}

export function describeApiFailure(status: number, serverMessage?: string, subject = "this data"): ApiFailure {
  if (looksWrittenForAPerson(serverMessage)) {
    return status === 401 ? { message: serverMessage, action: signIn } : { message: serverMessage };
  }

  switch (status) {
    case 401:
      return { message: `Sign in to see and change ${subject}.`, action: signIn };
    case 403:
      return {
        message: `Your account does not have access to ${subject}. Ask a workspace owner to grant it in Settings → Members.`,
      };
    case 404:
      return { message: "That item no longer exists. It may have been deleted by someone else." };
    case 409:
      return { message: "Someone else changed this first. Reload the page and try again." };
    case 429:
      return { message: "Too many requests in a short time. Wait a moment and try again." };
    case 503:
      return {
        message: `${capitalize(subject)} is temporarily unavailable. This is usually brief — try again shortly.`,
      };
    default:
      break;
  }

  if (status >= 500) {
    return { message: "Something went wrong on our side. Try again, and if it persists contact support." };
  }
  return { message: `${capitalize(subject)} could not be loaded. Try again.` };
}

/** The message for a fetch that never reached the server. */
export function describeNetworkFailure(): ApiFailure {
  return { message: "The network request failed. Check your connection and try again." };
}

function capitalize(value: string): string {
  const first = value[0];
  return first === undefined ? value : first.toUpperCase() + value.slice(1);
}
