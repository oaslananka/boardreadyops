"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Switch } from "./ui/switch.js";

/**
 * Renders nothing until mounted: next-themes can't know the resolved theme during SSR
 * (it depends on a client-only cookie/localStorage read), and rendering a guess here would
 * flash the wrong toggle state on first paint.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <span id="theme-toggle-label">{isDark ? "Dark" : "Light"}</span>
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-labelledby="theme-toggle-label"
      />
    </span>
  );
}
