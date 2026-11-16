"use client";

import { useSearchParams } from "next/navigation";

type SignInFailureReason = "unavailable" | "expired" | "denied";

const messages: Record<SignInFailureReason, { title: string; detail: string }> = {
  unavailable: {
    title: "GitHub sign-in is temporarily unavailable",
    detail: "We couldn't start or finish your sign-in. Your repository access hasn't been changed.",
  },
  expired: {
    title: "Your GitHub sign-in expired",
    detail: "This sign-in link is no longer valid. Start again to securely reconnect your account.",
  },
  denied: {
    title: "GitHub sign-in could not be completed",
    detail: "The sign-in was cancelled or GitHub couldn't verify the request. You can safely try again.",
  },
};

function knownReason(value: string | null): value is SignInFailureReason {
  return value === "unavailable" || value === "expired" || value === "denied";
}

export function SignInFailureNotice({ reason }: Readonly<{ reason: string | null }>) {
  if (!knownReason(reason)) return null;
  const message = messages[reason];

  return (
    <section
      aria-label="GitHub sign-in status"
      role="alert"
      className="mx-auto mt-6 flex w-full max-w-6xl flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h2 className="font-semibold text-foreground">{message.title}</h2>
        <p className="mt-1 text-muted-foreground">{message.detail}</p>
      </div>
      <a
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-4 py-2 font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        href="/api/auth/github/login"
      >
        Try GitHub sign-in again
      </a>
    </section>
  );
}

export function SignInFeedbackFromUrl() {
  const searchParams = useSearchParams();
  return <SignInFailureNotice reason={searchParams.get("sign_in")} />;
}
