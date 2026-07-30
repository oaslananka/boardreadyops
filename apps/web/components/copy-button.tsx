"use client";

import { useState } from "react";

type CopyButtonProps = Readonly<{
  label: string;
  value: string;
}>;

function copyStatusMessage(status: "copied" | "failed" | "idle"): string {
  if (status === "copied") return "Checksum copied.";
  if (status === "failed") return "Checksum could not be copied.";
  return "";
}

export function CopyButton({ label, value }: CopyButtonProps) {
  const [status, setStatus] = useState<"copied" | "failed" | "idle">("idle");

  async function copy(): Promise<void> {
    try {
      const clipboard = (globalThis.navigator as unknown as { clipboard?: { writeText(input: string): Promise<void> } })
        .clipboard;
      if (!clipboard) throw new Error("clipboard unavailable");
      await clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <span className="copy-control">
      <button className="button button-secondary button-compact" type="button" onClick={copy}>
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {copyStatusMessage(status)}
      </span>
    </span>
  );
}
