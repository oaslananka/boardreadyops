"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils.js";
import { buttonVariants } from "./ui/button.js";
import { Switch } from "./ui/switch.js";

export type ThemeToggleProps = {
  variant?: "switch" | "button";
  className?: string;
};

/**
 * Theme toggle supporting both an icon button variant (for headers) and a switch variant (for sidebars).
 * Defaults to dark theme if unset.
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
          <Sun className="size-4 text-warning transition-transform hover:rotate-45" />
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
