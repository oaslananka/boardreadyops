"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils.js";
import { buttonVariants } from "./ui/button.js";
import { Switch } from "./ui/switch.js";

export type ThemeToggleProps = {
  variant?: "switch" | "button" | "nav-row";
  className?: string;
};

/**
 * Theme toggle in three presentations: an icon button (headers), a switch (dense surfaces), and a
 * navigation row that matches the links beside it. Defaults to dark theme if unset.
 *
 * `nav-row` exists because the switch is 32x18 -- under the 44px touch minimum, and under WCAG
 * 2.5.8's 24px floor as well -- which the route audit flagged on mobile. A switch cannot simply be
 * grown: its own box paints the track, so padding distorts the control. Sitting among full-width
 * 44px rows it was also the odd one out, so the sidebar uses a row that states the action.
 */
export function ThemeToggle({ variant = "switch", className }: Readonly<ThemeToggleProps>) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    if (variant === "button") {
      return (
        <button
          type="button"
          disabled
          aria-label="Toggle theme"
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "size-9 border-border opacity-70 cursor-wait",
            className,
          )}
        >
          <Moon className="size-4 text-foreground" />
        </button>
      );
    }
    return null;
  }

  const isDark = resolvedTheme === "dark";

  if (variant === "nav-row") {
    return (
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent md:min-h-9",
          className,
        )}
      >
        {isDark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
        <span>{isDark ? "Switch to light" : "Switch to dark"}</span>
      </button>
    );
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "size-9 border-border text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer",
          className,
        )}
      >
        {isDark ? (
          <Sun className="size-4 text-foreground transition-transform hover:rotate-45" />
        ) : (
          <Moon className="size-4 text-foreground transition-transform hover:-rotate-12" />
        )}
      </button>
    );
  }

  return (
    <span className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <span id="theme-toggle-label">{isDark ? "Dark" : "Light"}</span>
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-labelledby="theme-toggle-label"
      />
    </span>
  );
}
