"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button.js";

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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function copy(): Promise<void> {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      const clipboard = (globalThis.navigator as unknown as { clipboard?: { writeText(input: string): Promise<void> } })
        .clipboard;
      if (!clipboard) throw new Error("clipboard unavailable");
      await clipboard.writeText(value);
      setStatus("copied");
      timeoutRef.current = setTimeout(() => {
        setStatus("idle");
        timeoutRef.current = null;
      }, 2000);
    } catch {
      setStatus("failed");
      timeoutRef.current = setTimeout(() => {
        setStatus("idle");
        timeoutRef.current = null;
      }, 2500);
    }
  }

  let buttonLabel = label;
  if (status === "copied") buttonLabel = "Copied ✓";
  else if (status === "failed") buttonLabel = "Copy failed";

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={copy}>
        {buttonLabel}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copyStatusMessage(status)}
      </span>
    </span>
  );
}
