import Link from "next/link";
import { cn } from "../lib/utils.js";
import { Card, CardContent } from "./ui/card.js";

export type GuidedChecklistStep = {
  id: string;
  label: string;
  status: "done" | "current" | "upcoming";
  href?: string;
  actionLabel?: string;
};

function StepMarker({ status, index }: Readonly<{ status: GuidedChecklistStep["status"]; index: number }>) {
  if (status === "done") {
    return (
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-[10px] font-bold text-background"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
        status === "current" ? "border-primary text-primary" : "border-border text-muted-foreground",
      )}
    >
      {index + 1}
    </span>
  );
}

export function GuidedChecklist({
  heading,
  steps,
}: Readonly<{ heading: string; steps: readonly GuidedChecklistStep[] }>) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-0 py-2">
        <h3 className="px-1 py-3 text-sm font-bold text-foreground">{heading}</h3>
        <ul>
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={cn(
                "flex items-center gap-3 border-t border-border px-1 py-2.5",
                step.status === "upcoming" && "text-muted-foreground",
              )}
            >
              <StepMarker status={step.status} index={index} />
              <span
                className={cn(
                  "text-sm",
                  step.status === "done" && "text-muted-foreground line-through",
                  step.status === "current" && "font-medium text-foreground",
                )}
              >
                {step.label}
              </span>
              {step.status === "current" && step.href && step.actionLabel ? (
                <Link href={step.href} className="ml-auto text-sm font-medium text-primary hover:underline">
                  {step.actionLabel} →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
