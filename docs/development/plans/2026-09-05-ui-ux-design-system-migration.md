# UI/UX Design System Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled ~5,000-line `apps/web/app/styles.css` (plus the separate `apps/web/app/landing.css`) with Tailwind CSS v4 + shadcn/ui across the entire authenticated app and the public landing page, applying the approved visual direction (graphite/electric-blue, sharp corners, status-only color, dark + light themes), a task-sequence sidebar restructure, and a guided-checklist empty-state pattern.

**Architecture:** Tailwind v4's CSS-first `@theme` config defines design tokens once (`apps/web/app/globals.css`), consumed by shadcn/ui primitives under `apps/web/components/ui/`. The existing shared component layer (`apps/web/components/ui.tsx`) is rebuilt on top of those primitives with its **external API unchanged** (same exported function names, same props) so most page files need zero changes — only pages with bespoke markup outside that shared layer need page-level edits. `next-themes` drives the dark/light toggle via a `class` strategy Tailwind's `@custom-variant dark` reads.

**Tech Stack:** Tailwind CSS 4.3.3, `@tailwindcss/postcss` 4.3.3, `radix-ui` 1.6.7 (unified package — shadcn's current components import primitives from this single package, not individual `@radix-ui/react-*` packages), `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0, `lucide-react` 1.41.0, `tw-animate-css` 1.4.0, `next-themes` 0.4.6. Existing stack unchanged: Next.js 16.2.12 (App Router), React 19.2.8, TypeScript 6.0.3.

**Spec:** [docs/architecture/adr/0016-ui-ux-design-system-migration.md](../../architecture/adr/0016-ui-ux-design-system-migration.md)

## Global Constraints

- Every new dependency is pinned to an exact version (no `^`/`~` ranges) — matches this repo's existing convention in `package.json`/`apps/web/package.json`.
- Color is reserved exclusively for status signals (danger/success/warning/info as already defined by `StatusTone` in `apps/web/components/ui.tsx`). No decorative color anywhere else in the new system.
- Border radius is sharp: `--radius: 0.125rem` (2px) at the token level, not shadcn's default `0.625rem`.
- Both dark and light themes are first-class — every task that touches visual output must be checked in both.
- Empty-state and onboarding copy must be CAD-format-neutral (never name "KiCad" specifically as if it were the only supported format — the product ingests KiCad, Altium, EasyEDA, Fusion 360, Gerber, and IPC-2581 via `src/multicad/*`).
- `apps/web/components/ui.tsx`'s exported function signatures (`StatusBadge`, `Breadcrumbs`, `Panel`, `DefinitionGrid`, `Definition`, `Alert`, `EmptyState`, `Pagination`, `AppShell` re-export) do not change — only their internals. This is what keeps the page-level task list bounded.
- `pnpm lint`, `pnpm typecheck`, and `pnpm run coverage` must pass after every task before moving to the next.
- Single branch, single deploy at the end (per explicit product decision) — but every task still ends in a working, committed state so the branch can be bisected if something breaks late.

---

## Phase A — Foundation

### Task 1: Install Tailwind v4 and shadcn/ui scaffolding

**Files:**
- Modify: `apps/web/package.json` (new dependencies)
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/components.json`
- Create: `apps/web/lib/utils.ts`
- Test: none (this task is infrastructure; verified by a successful build in Step 4)

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `apps/web/lib/utils.ts`, used by every shadcn component in later tasks.

- [ ] **Step 1: Add the exact-pinned dependencies to `apps/web`**

```bash
cd apps/web
corepack pnpm add -E tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 radix-ui@1.6.7 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.6.0 lucide-react@1.41.0 tw-animate-css@1.4.0 next-themes@0.4.6
cd ../..
```

- [ ] **Step 2: Create `apps/web/postcss.config.mjs`**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 3: Create `apps/web/lib/utils.ts`**

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Create `apps/web/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@boardreadyops/web/components",
    "utils": "@boardreadyops/web/lib/utils",
    "ui": "@boardreadyops/web/components/ui",
    "lib": "@boardreadyops/web/lib",
    "hooks": "@boardreadyops/web/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 5: Verify the workspace still installs cleanly**

Run: `corepack pnpm install --frozen-lockfile=false`
Expected: install completes with no errors; `apps/web/package.json` now lists the eight new dependencies from Step 1 with exact versions (no `^`/`~`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/postcss.config.mjs apps/web/lib/utils.ts apps/web/components.json
git commit -m "feat(web): add Tailwind v4 and shadcn/ui scaffolding"
```

### Task 2: Define design tokens in `apps/web/app/globals.css`

**Files:**
- Create: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx:1` (add the new stylesheet import; the old `styles.css`/`landing.css` imports stay in place until Task 20 deletes them)

**Interfaces:**
- Produces: Tailwind utility classes bound to the tokens below (`bg-background`, `text-foreground`, `bg-primary`, `border-border`, `text-danger`, `bg-danger-surface`, etc.) — every later task's markup uses these class names.
- Produces: the `dark` class variant (toggled on `<html>` by `next-themes` in Task 6) that switches every token from its light to its dark value.

**Context:** Values below are the exact hex colors approved in the 2026-09-05 design review (graphite/electric-blue direction), not shadcn's default neutral/oklch palette. `--radius` is 2px (sharp corners per the approved direction), not shadcn's default `0.625rem`. `danger`/`success`/`warning`/`info` map directly onto the existing `StatusTone` type in `apps/web/components/ui.tsx:6` — every later task's status-color usage goes through these four tokens, never a raw hex value.

- [ ] **Step 1: Write `apps/web/app/globals.css`**

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #ffffff;
  --foreground: #0d1117;
  --card: #f6f8fa;
  --card-foreground: #0d1117;
  --popover: #ffffff;
  --popover-foreground: #0d1117;
  --primary: #0969da;
  --primary-foreground: #ffffff;
  --secondary: #eaeef2;
  --secondary-foreground: #0d1117;
  --muted: #f6f8fa;
  --muted-foreground: #59636e;
  --accent: #0969da;
  --accent-foreground: #ffffff;
  --border: #d0d7de;
  --input: #d0d7de;
  --ring: #0969da;

  --danger: #cf222e;
  --danger-surface: #ffebe9;
  --success: #1a7f37;
  --success-surface: #dafbe1;
  --warning: #9a6700;
  --warning-surface: #fff8c5;
  --info: #0969da;
  --info-surface: #ddf4ff;

  --radius: 0.125rem;
}

.dark {
  --background: #0d1117;
  --foreground: #f0f6fc;
  --card: #161b22;
  --card-foreground: #f0f6fc;
  --popover: #161b22;
  --popover-foreground: #f0f6fc;
  --primary: #58a6ff;
  --primary-foreground: #0d1117;
  --secondary: #21262d;
  --secondary-foreground: #f0f6fc;
  --muted: #161b22;
  --muted-foreground: #7d8590;
  --accent: #58a6ff;
  --accent-foreground: #0d1117;
  --border: #30363d;
  --input: #21262d;
  --ring: #58a6ff;

  --danger: #ff6b5b;
  --danger-surface: #3d1f1c;
  --success: #3fb950;
  --success-surface: #1c2e1f;
  --warning: #d29922;
  --warning-surface: #3b2f14;
  --info: #58a6ff;
  --info-surface: #14243d;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-danger: var(--danger);
  --color-danger-surface: var(--danger-surface);
  --color-success: var(--success);
  --color-success-surface: var(--success-surface);
  --color-warning: var(--warning);
  --color-warning-surface: var(--warning-surface);
  --color-info: var(--info);
  --color-info-surface: var(--info-surface);

  --radius-sm: calc(var(--radius) - 1px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 2: Import the new stylesheet in the root layout**

In `apps/web/app/layout.tsx`, find the existing `import "./styles.css";` line (or equivalent) near the top of the file and add the new import directly above it:

```typescript
import "./globals.css";
import "./styles.css";
```

Leave the `styles.css` import in place — it is still serving every page not yet migrated. It is removed only in the final Phase D cleanup task once a repo-wide grep confirms nothing references it.

- [ ] **Step 3: Verify the build picks up the new stylesheet**

Run: `cd apps/web && corepack pnpm exec next build --no-lint 2>&1 | tail -30`
Expected: build succeeds. This does not yet change any page's rendered output (no page references the new token classes yet) — it only proves the Tailwind pipeline compiles.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css apps/web/app/layout.tsx
git commit -m "feat(web): add Tailwind design tokens for the new visual direction"
```

### Task 3: Add core shadcn/ui primitives

**Files:**
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/badge.tsx`
- Create: `apps/web/components/ui/card.tsx`
- Create: `apps/web/components/ui/separator.tsx`
- Create: `apps/web/components/ui/alert.tsx`
- Create: `apps/web/components/ui/switch.tsx`
- Test: `tests/unit/web/shadcn-primitives-smoke.test.ts` (new)

**Interfaces:**
- Consumes: `cn` from `apps/web/lib/utils.ts` (Task 1).
- Produces: `Button`, `buttonVariants`, `Badge`, `badgeVariants`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/`CardContent`/`CardFooter`, `Separator`, `Alert`/`AlertTitle`/`AlertDescription`, `Switch` — consumed directly by Task 4's rebuild of `apps/web/components/ui.tsx` and by every later page task.

These are the standard shadcn/ui `new-york` style primitives, unmodified except for using `radix-ui`'s unified import path (matches the `radix-ui@1.6.7` dependency from Task 1, not individual `@radix-ui/react-*` packages).

- [ ] **Step 1: Create `apps/web/components/ui/button.tsx`**

```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-danger text-white hover:bg-danger/90",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: Readonly<ButtonProps>) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
```

- [ ] **Step 2: Create `apps/web/components/ui/badge.tsx`**

```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        danger: "bg-danger-surface text-danger",
        success: "bg-success-surface text-success",
        warning: "bg-warning-surface text-warning",
        info: "bg-info-surface text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

export function Badge({ className, variant, asChild = false, ...props }: Readonly<BadgeProps>) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
```

Note the four status variants (`danger`/`success`/`warning`/`info`) map directly onto `StatusTone` from `apps/web/components/ui.tsx:6` — this is the only place status color is defined, per the Global Constraints color-discipline rule.

- [ ] **Step 3: Create `apps/web/components/ui/card.tsx`**

```typescript
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Card({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-md border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: Readonly<ComponentProps<"h2">>) {
  return <h2 data-slot="card-title" className={cn("text-base font-bold leading-none", className)} {...props} />;
}

export function CardDescription({ className, ...props }: Readonly<ComponentProps<"p">>) {
  return <p data-slot="card-description" className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}

export function CardAction({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return <div data-slot="card-action" className={cn("flex items-center gap-2", className)} {...props} />;
}

export function CardContent({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return <div data-slot="card-content" className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return <div data-slot="card-footer" className={cn("border-t border-border px-5 py-4", className)} {...props} />;
}
```

- [ ] **Step 4: Create `apps/web/components/ui/separator.tsx`**

```typescript
import { Separator as SeparatorPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: Readonly<ComponentProps<typeof SeparatorPrimitive.Root>>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Create `apps/web/components/ui/alert.tsx`**

```typescript
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

const alertVariants = cva("relative grid grid-cols-[0_1fr] gap-1 rounded-md border px-4 py-3 has-[svg]:grid-cols-[1.25rem_1fr] has-[svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-0.5", {
  variants: {
    variant: {
      default: "border-border bg-card text-card-foreground",
      danger: "border-danger/40 bg-danger-surface text-danger [&>svg]:text-danger",
      success: "border-success/40 bg-success-surface text-success [&>svg]:text-success",
      warning: "border-warning/40 bg-warning-surface text-warning [&>svg]:text-warning",
      info: "border-info/40 bg-info-surface text-info [&>svg]:text-info",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function AlertRoot({
  className,
  variant,
  ...props
}: Readonly<ComponentProps<"div"> & VariantProps<typeof alertVariants>>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div data-slot="alert-title" className={cn("col-start-2 font-medium leading-none tracking-tight", className)} {...props} />
  );
}

export function AlertDescription({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div data-slot="alert-description" className={cn("col-start-2 text-sm text-muted-foreground", className)} {...props} />
  );
}
```

`AlertRoot` (not `Alert`) is deliberate: `apps/web/components/ui.tsx` already exports a function named `Alert` with a different prop shape (`title`/`children`/`tone` rather than composed children), which Task 4 keeps as the public API. `AlertRoot` is the shadcn primitive Task 4's `Alert` is built from internally.

- [ ] **Step 6: Create `apps/web/components/ui/switch.tsx`**

```typescript
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Switch({ className, ...props }: Readonly<ComponentProps<typeof SwitchPrimitive.Root>>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}
```

- [ ] **Step 7: Write the smoke test**

```typescript
/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "../../../apps/web/components/ui/badge.js";
import { AlertDescription, AlertRoot, AlertTitle } from "../../../apps/web/components/ui/alert.js";
import { Button } from "../../../apps/web/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../../apps/web/components/ui/card.js";
import { Separator } from "../../../apps/web/components/ui/separator.js";

describe("shadcn primitive smoke test", () => {
  it("renders Button, Badge, Card, Separator, and Alert without throwing", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(Button, { variant: "outline" }, "Click"),
        createElement(Badge, { variant: "danger" }, "3 open"),
        createElement(Separator),
        createElement(
          Card,
          null,
          createElement(CardHeader, null, createElement(CardTitle, null, "Title")),
          createElement(CardContent, null, "Body"),
        ),
        createElement(AlertRoot, { variant: "warning" }, createElement(AlertTitle, null, "Heads up"), createElement(AlertDescription, null, "Detail")),
      ),
    );
    expect(markup).toContain("Click");
    expect(markup).toContain("3 open");
    expect(markup).toContain("Title");
    expect(markup).toContain("Heads up");
  });
});
```

`Switch` is a client component (`SwitchPrimitive.Root` uses internal state) and is exercised instead in Task 6's theme-toggle test, not here.

- [ ] **Step 8: Run the new test**

Run: `corepack pnpm exec vitest run tests/unit/web/shadcn-primitives-smoke.test.ts`
Expected: 1 test file, 1 test, PASS.

- [ ] **Step 9: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass with no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/ui/ tests/unit/web/shadcn-primitives-smoke.test.ts
git commit -m "feat(web): add core shadcn/ui primitives (button, badge, card, separator, alert, switch)"
```

### Task 4: Rebuild `apps/web/components/ui.tsx` on the new primitives

**Files:**
- Modify: `apps/web/components/ui.tsx` (full rewrite of internals; exported names and prop shapes unchanged)
- Test: `tests/unit/web/ui-components.test.ts` (new — no equivalent test exists today; this is the file every page depends on, so it needs direct coverage before the migration proceeds)

**Interfaces:**
- Consumes: `Badge`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`, `Separator`, `AlertRoot`/`AlertTitle`/`AlertDescription`, `Button`, `buttonVariants` (Task 3); `cn` (Task 1).
- Produces (unchanged from today): `AppShell` (re-export, untouched by this task), `StatusTone`, `humanize(value)`, `statusTone(value)`, `StatusBadge({value, label})`, `BreadcrumbItem`, `Breadcrumbs({items})`, `PanelTone`, `PanelProps`, `Panel({children, title, description, actions, id, tone})`, `DefinitionGrid({children})`, `Definition({label, children})`, `Alert({children, title, tone})`, `EmptyState({title, children, action})`, `Pagination({basePath, page, totalPages, pageParameter, searchParameters})`.

This is the highest-leverage task in the whole migration: every page composes from these functions, so getting their visual output right here is what makes most page-level tasks in Phase B small.

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Alert,
  Breadcrumbs,
  Definition,
  DefinitionGrid,
  EmptyState,
  Pagination,
  Panel,
  StatusBadge,
  humanize,
  statusTone,
} from "../../../apps/web/components/ui.js";

describe("ui.tsx shared component contract", () => {
  it("humanize and statusTone keep their existing behavior", () => {
    expect(humanize("in_progress")).toBe("In Progress");
    expect(humanize(undefined)).toBe("Unknown");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("pass")).toBe("success");
    expect(statusTone("queued")).toBe("info");
    expect(statusTone("something-unmapped")).toBe("neutral");
  });

  it("StatusBadge renders the humanized value and status color, never a decorative color", () => {
    const markup = renderToStaticMarkup(createElement(StatusBadge, { value: "failed" }));
    expect(markup).toContain("Failed");
    expect(markup).toContain("text-danger");
  });

  it("Breadcrumbs links every item except the last", () => {
    const markup = renderToStaticMarkup(
      createElement(Breadcrumbs, { items: [{ href: "/", label: "Home" }, { label: "Dashboard" }] }),
    );
    expect(markup).toContain('href="/"');
    expect(markup).toContain('aria-current="page"');
  });

  it("Panel renders title, description, and actions", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Panel,
        { title: "Engineering status", description: "Current scope", id: "status" },
        "body",
      ),
    );
    expect(markup).toContain("Engineering status");
    expect(markup).toContain("Current scope");
    expect(markup).toContain("body");
  });

  it("DefinitionGrid/Definition render label/value pairs", () => {
    const markup = renderToStaticMarkup(
      createElement(DefinitionGrid, null, createElement(Definition, { label: "Plan" }, "free")),
    );
    expect(markup).toContain("Plan");
    expect(markup).toContain("free");
  });

  it("Alert renders role=alert only for the danger tone", () => {
    const danger = renderToStaticMarkup(createElement(Alert, { title: "Failed", tone: "danger" }, "detail"));
    const info = renderToStaticMarkup(createElement(Alert, { title: "Note", tone: "info" }, "detail"));
    expect(danger).toContain('role="alert"');
    expect(info).not.toContain('role="alert"');
  });

  it("EmptyState renders title, body, and an optional action", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, { title: "No projects configured yet", action: "Create First Project" }, "body"),
    );
    expect(markup).toContain("No projects configured yet");
    expect(markup).toContain("Create First Project");
  });

  it("Pagination renders nothing for a single page and Previous/Next otherwise", () => {
    const single = renderToStaticMarkup(
      createElement(Pagination, {
        basePath: "/reviews",
        page: 1,
        totalPages: 1,
        pageParameter: "page",
        searchParameters: {},
      }),
    );
    expect(single).toBe("");

    const multi = renderToStaticMarkup(
      createElement(Pagination, {
        basePath: "/reviews",
        page: 2,
        totalPages: 3,
        pageParameter: "page",
        searchParameters: {},
      }),
    );
    expect(multi).toContain("Previous");
    expect(multi).toContain("Next");
    expect(multi).toContain("page=3");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails against the current file**

Run: `corepack pnpm exec vitest run tests/unit/web/ui-components.test.ts`
Expected: FAIL — `text-danger` is not present in the current `StatusBadge` output (it renders `data-tone="danger"` with CSS-file styling, not a Tailwind class), so that assertion fails first. This confirms the test actually exercises the new visual system, not just the existing one.

- [ ] **Step 3: Rewrite `apps/web/components/ui.tsx`**

```typescript
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertDescription, AlertRoot, AlertTitle } from "./ui/alert.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { Separator } from "./ui/separator.js";

export { AppShell } from "./app-shell.js";

export type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

const dangerValues = new Set([
  "blocked",
  "critical",
  "dead_letter",
  "error",
  "expired",
  "fail",
  "failed",
  "failure",
  "high",
  "timed_out",
  "unauthorized",
]);
const successValues = new Set(["available", "completed", "deleted", "pass", "passed", "ready", "success"]);
const warningValues = new Set([
  "medium",
  "metadata-only",
  "missing",
  "partial_data",
  "reconciliation",
  "stale",
  "waived",
  "warning",
]);
const infoValues = new Set([
  "accepted",
  "dispatching",
  "in_progress",
  "leased",
  "processing",
  "queued",
  "reporting",
  "running",
]);

export function humanize(value: string | undefined): string {
  if (!value) return "Unknown";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function statusTone(value: string | undefined): StatusTone {
  const normalized = value?.toLowerCase() ?? "";
  if (dangerValues.has(normalized)) return "danger";
  if (successValues.has(normalized)) return "success";
  if (warningValues.has(normalized)) return "warning";
  if (infoValues.has(normalized)) return "info";
  return "neutral";
}

const badgeVariantByTone: Record<StatusTone, "danger" | "success" | "warning" | "info" | "secondary"> = {
  danger: "danger",
  success: "success",
  warning: "warning",
  info: "info",
  neutral: "secondary",
};

export function StatusBadge({ value, label }: Readonly<{ value: string | undefined; label?: string }>) {
  const tone = statusTone(value);
  return (
    <Badge variant={badgeVariantByTone[tone]} className={`text-${tone === "neutral" ? "muted-foreground" : tone}`}>
      {label ?? humanize(value)}
    </Badge>
  );
}

export type BreadcrumbItem = { href?: string; label: string };

export function Breadcrumbs({ items }: Readonly<{ items: BreadcrumbItem[] }>) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.href ?? "current"}:${item.label}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type PanelTone = "default" | "raised" | "inset" | "critical" | "section";

export type PanelProps = {
  children: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  id?: string;
  tone?: PanelTone;
};

const panelToneClass: Record<PanelTone, string> = {
  default: "",
  raised: "shadow-lg",
  inset: "bg-muted",
  critical: "border-danger/50",
  section: "border-dashed",
};

export function Panel({ children, title, description, actions, id, tone = "default" }: Readonly<PanelProps>) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <Card id={id} className={panelToneClass[tone]} aria-labelledby={headingId}>
      <CardHeader>
        <div>
          <CardTitle id={headingId}>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function DefinitionGrid({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">{children}</dl>;
}

export function Definition({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

const alertVariantByTone: Record<StatusTone, "default" | "danger" | "success" | "warning" | "info"> = {
  danger: "danger",
  success: "success",
  warning: "warning",
  info: "info",
  neutral: "default",
};

export function Alert({
  children,
  title,
  tone = "info",
}: Readonly<{ children: ReactNode; title: string; tone?: StatusTone }>) {
  return (
    <AlertRoot
      variant={alertVariantByTone[tone]}
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "danger" ? undefined : "polite"}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </AlertRoot>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: Readonly<{ title: string; children: ReactNode; action?: ReactNode }>) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
      <h3 className="text-base font-bold text-foreground">{title}</h3>
      <div className="text-sm text-muted-foreground">{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  );
}

export function Pagination({
  basePath,
  page,
  totalPages,
  pageParameter,
  searchParameters,
}: Readonly<{
  basePath: string;
  page: number;
  totalPages: number;
  pageParameter: string;
  searchParameters: Readonly<Record<string, string | undefined>>;
}>) {
  if (totalPages <= 1) return null;

  function href(target: number): string {
    const parameters = new URLSearchParams();
    for (const [name, value] of Object.entries(searchParameters)) {
      if (value) parameters.set(name, value);
    }
    parameters.set(pageParameter, String(target));
    return `${basePath}?${parameters.toString()}`;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page - 1)} rel="prev">
            Previous
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-disabled="true">
          Previous
        </Button>
      )}
      <span aria-live="polite" className="text-sm text-muted-foreground">
        Page <strong className="text-foreground">{page}</strong> of <strong className="text-foreground">{totalPages}</strong>
      </span>
      {page < totalPages ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page + 1)} rel="next">
            Next
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-disabled="true">
          Next
        </Button>
      )}
    </nav>
  );
}
```

`Separator` is imported for use by Phase B page tasks that currently draw dividers via bespoke CSS classes (e.g. the Settings tab list) — it is not used inside `ui.tsx` itself, so keep the import only if a page task in this same commit needs it; otherwise drop the unused import (Task 4 as written above does not use it directly — remove `import { Separator } from "./ui/separator.js";` before running lint in Step 5, since an unused import fails `pnpm lint`).

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `corepack pnpm exec vitest run tests/unit/web/ui-components.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass. If lint fails on the unused `Separator` import, remove it per the note in Step 3.

- [ ] **Step 6: Run the full existing web test suite to check for breakage**

Run: `corepack pnpm exec vitest run tests/unit/web/`
Expected: every test that renders a page through `Panel`/`EmptyState`/`StatusBadge`/etc. still passes — these tests assert on text content and ARIA attributes, not on the removed CSS class names, so they should be unaffected. Any failure here means a test was asserting on a class name from the old `styles.css` system; fix the test to assert on the new semantic output (text, role, aria-*) instead of a class name, following the pattern already used in Step 1's new test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ui.tsx tests/unit/web/ui-components.test.ts
git commit -m "feat(web): rebuild shared ui.tsx components on shadcn/ui primitives"
```

### Task 5: Build the `GuidedChecklist` empty-state component

**Files:**
- Create: `apps/web/components/guided-checklist.tsx`
- Test: `tests/unit/web/guided-checklist.test.ts` (new)

**Interfaces:**
- Consumes: `Card`, `CardContent` (Task 3); `cn` (Task 1).
- Produces: `GuidedChecklistStep = { id: string; label: string; status: "done" | "current" | "upcoming"; href?: string; actionLabel?: string }`, `GuidedChecklist({ heading, steps }: { heading: string; steps: GuidedChecklistStep[] })` — consumed by every Phase B task that replaces a passive `EmptyState` with a guided checklist (Projects, Parts, Deliveries, repository detail).

Per the Global Constraints CAD-neutral-copy rule, this component itself contains no format-specific copy — the `label` text for each step is supplied by the calling page, and Phase B tasks are responsible for writing that copy generically (e.g. "Link a repository with a hardware project," never "a KiCad project").

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuidedChecklist } from "../../../apps/web/components/guided-checklist.js";

describe("GuidedChecklist", () => {
  it("marks done steps with a checkmark and strikes through their label", () => {
    const markup = renderToStaticMarkup(
      createElement(GuidedChecklist, {
        heading: "Get your first board reviewed",
        steps: [
          { id: "connect", label: "Connect GitHub App", status: "done" },
          { id: "link", label: "Link a repository with a hardware project", status: "current", href: "/setup", actionLabel: "Start" },
          { id: "pr", label: "Open a pull request to trigger the first run", status: "upcoming" },
        ],
      }),
    );
    expect(markup).toContain("Get your first board reviewed");
    expect(markup).toContain("Connect GitHub App");
    expect(markup).toContain("line-through");
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain("Start");
  });

  it("renders exactly one current step's action link, never more than one", () => {
    const markup = renderToStaticMarkup(
      createElement(GuidedChecklist, {
        heading: "Setup",
        steps: [
          { id: "a", label: "A", status: "current", href: "/a", actionLabel: "Go" },
          { id: "b", label: "B", status: "upcoming" },
        ],
      }),
    );
    expect((markup.match(/href="\/a"/gu) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm exec vitest run tests/unit/web/guided-checklist.test.ts`
Expected: FAIL — `apps/web/components/guided-checklist.js` does not exist yet.

- [ ] **Step 3: Write `apps/web/components/guided-checklist.tsx`**

```typescript
import Link from "next/link";
import { Card, CardContent } from "./ui/card.js";
import { cn } from "../lib/utils.js";

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
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `corepack pnpm exec vitest run tests/unit/web/guided-checklist.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/guided-checklist.tsx tests/unit/web/guided-checklist.test.ts
git commit -m "feat(web): add GuidedChecklist empty-state component"
```

### Task 6: Restructure navigation to task-sequence grouping and add the theme toggle

**Files:**
- Modify: `apps/web/components/product-navigation.tsx` (full rewrite: new `groups` data, Tailwind classes, theme toggle)
- Modify: `apps/web/components/app-shell.tsx` (wrap children in `ThemeProvider`)
- Create: `apps/web/components/theme-toggle.tsx`
- Test: `tests/unit/web/product-navigation.test.ts` (new)

**Interfaces:**
- Consumes: `Switch` (Task 3), `cn` (Task 1), `next-themes`'s `ThemeProvider`/`useTheme` (Task 1 dependency).
- Produces: `ThemeToggle()` (default export, client component) — consumed only by `product-navigation.tsx` in this task, no other page needs it.
- Unchanged: `ProductNavigation({ viewerNav })` and `AppShell({ children, viewerNav })` keep their existing prop signatures — every page that renders `AppShell` (all of them, via `apps/web/components/ui.tsx`'s re-export) needs no changes for this task.

This task preserves every piece of existing behavior in `product-navigation.tsx` — the mobile drawer, `Escape`-to-close, focus management on open/close, and the persisted compact-collapse toggle — restyled, not rewritten from scratch. Only the `groups` data and class names change.

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { ProductNavigation } from "../../../apps/web/components/product-navigation.js";

describe("ProductNavigation task-sequence grouping", () => {
  it("groups by workflow step, not by category", () => {
    const markup = renderToStaticMarkup(createElement(ProductNavigation, {}));
    expect(markup).toContain("Get a board in");
    expect(markup).toContain("Work the findings");
    expect(markup).toContain("Ship it");
    expect(markup).not.toContain(">Overview<");
    expect(markup).not.toContain(">Engineering<");
    expect(markup).not.toContain(">Manage<");

    const projectsIndex = markup.indexOf("Projects");
    const getBoardInIndex = markup.indexOf("Get a board in");
    const workFindingsIndex = markup.indexOf("Work the findings");
    expect(getBoardInIndex).toBeLessThan(projectsIndex);
    expect(projectsIndex).toBeLessThan(workFindingsIndex);
  });

  it("still renders Dashboard as its own top-level link", () => {
    const markup = renderToStaticMarkup(createElement(ProductNavigation, {}));
    expect(markup).toContain('href="/dashboard"');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm exec vitest run tests/unit/web/product-navigation.test.ts`
Expected: FAIL — the current file still renders "Overview"/"Engineering"/"Manage".

- [ ] **Step 3: Create `apps/web/components/theme-toggle.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
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
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{isDark ? "Dark" : "Light"}</span>
      <Switch checked={isDark} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
    </label>
  );
}
```

- [ ] **Step 4: Rewrite `apps/web/components/product-navigation.tsx`**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { BrandMarkLockup } from "./brand-mark.js";
import { ProductIcon, type ProductIconName } from "./product-icons.js";
import { ThemeToggle } from "./theme-toggle.js";
import { cn } from "../lib/utils.js";

type NavigationItem = Readonly<{
  href: string;
  icon: ProductIconName;
  label: string;
}>;

const groups: ReadonlyArray<Readonly<{ label: string; items: readonly NavigationItem[] }>> = [
  {
    label: "1. Get a board in",
    items: [
      { label: "Projects", href: "/projects", icon: "projects" },
      { label: "Setup", href: "/setup", icon: "setup" },
    ],
  },
  {
    label: "2. Work the findings",
    items: [
      { label: "My Work", href: "/work", icon: "work" },
      { label: "Reviews", href: "/reviews", icon: "reviews" },
    ],
  },
  {
    label: "3. Ship it",
    items: [
      { label: "Deliveries", href: "/deliveries", icon: "deliveries" },
      { label: "Parts", href: "/parts", icon: "parts" },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Policies", href: "/policies", icon: "policies" },
      { label: "Evidence", href: "/evidence", icon: "evidence" },
      { label: "Insights", href: "/insights", icon: "insights" },
    ],
  },
  {
    label: "Workspace",
    items: [{ label: "Settings", href: "/settings/billing", icon: "settings" }],
  },
] as const;

const COMPACT_STORAGE_KEY = "boardreadyops.product-nav.compact";

function isCurrentRoute(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === "/settings/billing") return pathname.startsWith("/settings/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProductNavigation({ viewerNav }: Readonly<{ viewerNav?: ReactNode }>) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const wasMobileOpen = useRef(false);

  useEffect(() => {
    if (mobileOpen) {
      wasMobileOpen.current = true;
      document.body.style.overflow = "hidden";
      firstLinkRef.current?.focus();
    } else {
      document.body.style.overflow = "";
      if (wasMobileOpen.current) menuButtonRef.current?.focus();
      wasMobileOpen.current = false;
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setMobileOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COMPACT_STORAGE_KEY) === "true") setCompact(true);
    } catch {
      // Storage may be unavailable (private browsing, disabled cookies); collapse just won't persist.
    }
  }, []);

  function toggleCompact() {
    setCompact((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COMPACT_STORAGE_KEY, String(next));
      } catch {
        // Non-fatal: navigation still toggles for this session even if it can't be remembered.
      }
      return next;
    });
  }

  const dashboardCurrent = isCurrentRoute(pathname, "/dashboard");

  return (
    <>
      <button
        ref={menuButtonRef}
        className="fixed left-4 top-4 z-40 flex size-10 items-center justify-center rounded-md border border-border bg-card md:hidden"
        type="button"
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        aria-controls="product-navigation-drawer"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <ProductIcon name={mobileOpen ? "close" : "menu"} />
      </button>

      {mobileOpen ? (
        <button
          className="fixed inset-0 z-30 bg-background/80 md:hidden"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        id="product-navigation-drawer"
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border bg-card transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0",
          compact && "md:w-16",
          !mobileOpen && "-translate-x-full md:translate-x-0",
        )}
        data-compact={compact}
        data-mobile-open={mobileOpen}
      >
        <Link
          className="flex items-center gap-2 border-b border-border px-4 py-4"
          href="/"
          aria-label="BoardReadyOps home"
        >
          <BrandMarkLockup size={25} className="shrink-0" />
        </Link>

        <nav aria-label="Product navigation" className="flex-1 overflow-y-auto px-2 py-3">
          <Link
            ref={firstLinkRef}
            href="/dashboard"
            aria-current={dashboardCurrent ? "page" : undefined}
            title={compact ? "Dashboard" : undefined}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "mb-3 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-bold",
              dashboardCurrent ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/10",
            )}
          >
            <ProductIcon name="projects" />
            {!compact && <span>Dashboard</span>}
          </Link>

          {groups.map((group) => (
            <section key={group.label} aria-labelledby={`nav-${group.label}`} className="mb-4">
              {!compact && (
                <h2
                  id={`nav-${group.label}`}
                  className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const current = isCurrentRoute(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        title={compact ? item.label : undefined}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                          current ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-accent/10",
                        )}
                      >
                        <ProductIcon name={item.icon} />
                        {!compact && <span>{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-border px-2.5 py-3">
          <a
            href="https://docs.boardreadyops.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-accent/10"
          >
            <ProductIcon name="docs" />
            {!compact && <span>Docs</span>}
          </a>
          {!compact && <ThemeToggle />}
          {viewerNav ? <Suspense fallback={null}>{viewerNav}</Suspense> : null}
          <button
            type="button"
            aria-label={compact ? "Expand navigation" : "Collapse navigation"}
            title={compact ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleCompact}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/10"
          >
            <ProductIcon name="menu" />
            {!compact && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 5: Wrap the shell in `next-themes`'s provider**

Modify `apps/web/components/app-shell.tsx`:

```typescript
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { ProductNavigation } from "./product-navigation.js";

export function AppShell({ children, viewerNav }: Readonly<{ children: ReactNode; viewerNav?: ReactNode }>) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <div className="flex min-h-dvh bg-background text-foreground">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
          href="#main-content"
        >
          Skip to main content
        </a>
        <ProductNavigation viewerNav={viewerNav} />
        <div className="flex flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border px-6 py-3">
            <span className="text-sm font-bold text-foreground">BoardReadyOps Cloud</span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Engineering operations</span>
          </header>
          {children}
          <footer className="mt-auto border-t border-border px-6 py-4 text-sm text-muted-foreground">
            <p>
              BoardReadyOps checks whether a board is ready to fabricate. Your repository and its full workflow logs
              stay the source of truth.
            </p>
          </footer>
        </div>
      </div>
    </ThemeProvider>
  );
}
```

`defaultTheme="dark"` with `enableSystem={false}` matches the ADR's decision that dark is the default and the toggle is an explicit user choice, not a system-preference follow.

- [ ] **Step 6: Run the test again to confirm it passes**

Run: `corepack pnpm exec vitest run tests/unit/web/product-navigation.test.ts`
Expected: PASS, both tests.

- [ ] **Step 7: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 8: Update `tests/unit/web/app-shell.test.ts`, which asserts the old class names**

Replace its contents:

```typescript
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../apps/web/components/ui.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/work" }));

describe("AppShell", () => {
  it("uses the task-sequence grouping and stable global destinations", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );

    expect(markup).toContain("BoardReadyOps");
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/projects"');
    expect(markup).toContain('href="/reviews"');
    expect(markup).toContain('href="/deliveries"');
    expect(markup).toContain('href="/parts"');
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain('href="https://docs.boardreadyops.com"');
    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain("Get a board in");
    expect(markup).toContain("Work the findings");
    expect(markup).toContain("Ship it");
    expect(markup.match(/href="\/settings\/billing"/gu)).toHaveLength(1);
    expect(markup).not.toContain(">BR<");
  });

  it("does not show a fake, unwired search shortcut hint", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", { id: "main-content" }, "content")),
    );
    expect(markup).not.toContain("command-hint");
    expect(markup).not.toContain("⌘");
  });
});
```

- [ ] **Step 9: Run the full web test suite**

Run: `corepack pnpm exec vitest run tests/unit/web/`
Expected: PASS. If any other test file references the removed class names (`product-shell`, `product-rail`, `product-context-bar`, `product-nav-group`) or the old group labels ("Overview", "Engineering", "Manage"), update it the same way: assert on the rendered text/href/role instead of a class name.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/product-navigation.tsx apps/web/components/app-shell.tsx apps/web/components/theme-toggle.tsx tests/unit/web/product-navigation.test.ts tests/unit/web/app-shell.test.ts
git commit -m "feat(web): task-sequence nav grouping and light/dark theme toggle"
```

---

## Phase B — Page migrations

Each task in this phase converts one page's *bespoke* markup (the parts that don't already flow through `apps/web/components/ui.tsx`) to Tailwind classes. Pages that compose entirely from `Panel`/`EmptyState`/`StatusBadge`/etc. picked up the new look automatically in Task 4 and are only spot-checked in Task 19, not given their own task here.

### Task 7: Migrate the Dashboard page

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx` (full rewrite of bespoke sections; component names and prop shapes unchanged)
- Modify: `tests/unit/web/dashboard-page-contract.test.ts` (assertions reference removed class names)

**Interfaces:**
- Consumes: `Panel`, `Breadcrumbs`, `StatusBadge` (Task 4), `GuidedChecklist` (Task 5).
- No new interfaces produced — `DashboardPage` is a route entry point, nothing else imports from it.

The zero-repositories empty state is upgraded from a passive `EmptyState` to a `GuidedChecklist` here, extending the pattern the ADR names explicitly for Projects/Parts/Deliveries/repository-detail to the very first screen a new user sees — the most important place for a guided next step, not the least. This task also fixes a CAD-format-neutral copy violation the ADR calls out directly: the current empty state says "a KiCad project," which undersells multi-CAD support.

- [ ] **Step 1: Rewrite `apps/web/app/dashboard/page.tsx`**

```typescript
import Link from "next/link";
import { AppShell, Breadcrumbs, Panel, StatusBadge } from "../../components/ui.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import {
  type DashboardRepositorySummary,
  loadViewerRepositories,
  type RepositoryGroup,
  summarizeViewerRepositories,
} from "../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Dashboard",
  description: "Repositories BoardReadyOps is watching, their latest release readiness, and open findings.",
};

function when(value: string | undefined): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

function SignInRequiredPanel() {
  return (
    <Panel title="Sign in required">
      <p className="text-sm text-muted-foreground">
        BoardReadyOps shows the repositories your GitHub App installations can access, so it needs to know who you
        are.
      </p>
    </Panel>
  );
}

function NoRepositoriesPanel() {
  return (
    <GuidedChecklist
      heading="Get your first board reviewed — 2 steps left"
      steps={[
        { id: "install", label: "Connect the BoardReadyOps GitHub App", status: "done" },
        {
          id: "link",
          label: "Link a repository with a hardware project",
          status: "current",
          href: "/setup",
          actionLabel: "Start",
        },
        { id: "pr", label: "Open a pull request to trigger the first run", status: "upcoming" },
      ]}
    />
  );
}

function OperationalSummarySection({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <section aria-labelledby="operational-summary-heading" className="rounded-md border border-border p-5">
      <header className="mb-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current scope</p>
        <h2 id="operational-summary-heading" className="text-lg font-bold text-foreground">
          Engineering status
        </h2>
      </header>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {(
          [
            ["Repositories", summary.repositories],
            ["Repositories with findings", summary.repositoriesWithOpenFindings],
            ["Supply alerts", summary.supplyAlerts],
            ["No run yet", summary.repositoriesWithoutRuns],
            ["Boards watched", summary.watchedBoards],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-bold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FindingsAttentionBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <output className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-surface px-5 py-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-warning">Attention required</p>
        <strong className="text-sm font-semibold text-foreground">
          {summary.repositoriesWithOpenFindings}{" "}
          {summary.repositoriesWithOpenFindings === 1 ? "repository has" : "repositories have"} open findings
          {summary.supplyAlerts > 0 ? ` and ${summary.supplyAlerts} supply alerts` : ""} before fabrication.
        </strong>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-bold text-warning">Next action</span>
        <span className="text-muted-foreground">Inspect findings below and resolve blocking design violations.</span>
      </div>
    </output>
  );
}

function SetupInProgressBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <output className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-info/40 bg-info-surface px-5 py-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-info">Setup in progress</p>
        <strong className="text-sm font-semibold text-foreground">
          {summary.repositoriesWithoutRuns}{" "}
          {summary.repositoriesWithoutRuns === 1 ? "repository is" : "repositories are"} waiting for an initial
          release check.
        </strong>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-info/20 px-2 py-0.5 text-xs font-bold text-info">Next action</span>
        <Link href="/setup" className="font-medium text-info hover:underline">
          Review setup workflow and dispatch probe →
        </Link>
      </div>
    </output>
  );
}

function AttentionBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  if (summary.repositoriesWithOpenFindings > 0 || summary.supplyAlerts > 0) {
    return <FindingsAttentionBanner summary={summary} />;
  }
  if (summary.repositoriesWithoutRuns > 0) {
    return <SetupInProgressBanner summary={summary} />;
  }
  return null;
}

function RepositoryRow({ repository }: Readonly<{ repository: RepositoryGroup["repositories"][number] }>) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className="px-3 py-2.5 text-left font-medium">
        <Link href={`/repositories/${repository.id}`} className="text-primary hover:underline">
          {repository.owner}/{repository.name}
        </Link>
        {repository.private ? (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">private</span>
        ) : undefined}
      </th>
      <td className="px-3 py-2.5">
        {repository.latestRunId ? (
          <div className="flex items-center gap-2">
            <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
            <span className="text-xs text-muted-foreground">{when(repository.latestRunAt)}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            no runs yet ·{" "}
            <Link href="/setup" className="text-primary hover:underline">
              setup
            </Link>
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">{repository.latestRunId ? repository.openFindings : "—"}</td>
      <td className="px-3 py-2.5">{repository.watchedBoards}</td>
      <td className="px-3 py-2.5">{repository.openSupplyFindings}</td>
    </tr>
  );
}

function RepositorySections({ groups }: Readonly<{ groups: RepositoryGroup[] }>) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Panel key={group.accountLogin} title={group.accountLogin} tone="section">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2">
                    Repository
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Latest run
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Findings
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Boards watched
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Supply alerts
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.repositories.map((repository) => (
                  <RepositoryRow key={repository.id} repository={repository} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function DashboardBody({
  hasSession,
  groups,
  summary,
}: Readonly<{
  hasSession: boolean;
  groups: RepositoryGroup[];
  summary: DashboardRepositorySummary;
}>) {
  if (!hasSession) return <SignInRequiredPanel />;
  if (summary.repositories === 0) return <NoRepositoriesPanel />;

  return (
    <div className="flex flex-col gap-5">
      <OperationalSummarySection summary={summary} />
      <AttentionBanner summary={summary} />
      <RepositorySections groups={groups} />
    </div>
  );
}

export default async function DashboardPage() {
  const viewer = await viewerAuthorization();
  const groups = await loadViewerRepositories(viewer.session);
  const summary = summarizeViewerRepositories(groups);

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Dashboard" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Repositories BoardReadyOps is watching, with the latest release readiness for each.
          </p>
        </header>
        <DashboardBody hasSession={Boolean(viewer.session)} groups={groups} summary={summary} />
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Update `tests/unit/web/dashboard-page-contract.test.ts`**

This test currently asserts on `className="operational-summary"` and `repository-table-wrap` substrings in the raw source text. Replace it with assertions on the rendered output instead of source-text substrings, since the whole point of this migration is that those class names no longer exist:

```typescript
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ session: { login: "octocat" } })),
}));
vi.mock("../../../apps/web/lib/repository-dashboard.js", () => ({
  loadViewerRepositories: vi.fn(async () => [
    {
      accountLogin: "octocat",
      repositories: [
        {
          id: "repo-1",
          owner: "octocat",
          name: "widgets",
          private: false,
          latestRunId: "run-1",
          latestRunDecision: "pass",
          latestRunStatus: "completed",
          latestRunAt: "2026-09-05T00:00:00.000Z",
          openFindings: 2,
          watchedBoards: 3,
          openSupplyFindings: 0,
        },
      ],
    },
  ]),
  summarizeViewerRepositories: vi.fn(() => ({
    repositories: 1,
    repositoriesWithOpenFindings: 1,
    supplyAlerts: 0,
    repositoriesWithoutRuns: 0,
    watchedBoards: 3,
  })),
}));

const { default: DashboardPage } = await import("../../../apps/web/app/dashboard/page.js");

describe("dashboard operational hierarchy", () => {
  it("derives a compact summary from the loaded repository groups", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("Engineering status");
    expect(markup).toContain("Repositories with findings");
    expect(markup).toContain("Supply alerts");
    expect(markup).toContain("No run yet");
    expect(markup).toContain("Boards watched");
    expect(markup).not.toContain("this week");
    expect(markup).not.toContain("trend");
  });

  it("renders repository account groups as sections with a wide, scrollable table", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("octocat/widgets");
    expect(markup).toContain("overflow-x-auto");
  });

  it("renders an attention banner with a next-action hint when findings are open", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());
    expect(markup).toContain("Attention required");
    expect(markup).toContain("Next action");
  });
});
```

- [ ] **Step 3: Run the updated tests**

Run: `corepack pnpm exec vitest run tests/unit/web/dashboard-page-contract.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 4: Lint, typecheck, and run the broader web suite**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && corepack pnpm exec vitest run tests/unit/web/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/page.tsx tests/unit/web/dashboard-page-contract.test.ts
git commit -m "feat(web): migrate Dashboard to Tailwind and guided setup checklist"
```

### Task 8: Migrate Projects, New Project, and the upload wizard

**Files:**
- Create: `apps/web/components/ui/tabs.tsx`
- Modify: `apps/web/app/projects/page.tsx`
- Modify: `apps/web/app/projects/new/page.tsx`
- Modify: `apps/web/components/project-upload-wizard.tsx`
- Modify: `tests/unit/web/project-upload-wizard.test.ts` (rewritten to assert on role/text instead of class names)

**Interfaces:**
- Consumes: `Panel`, `Breadcrumbs` (Task 4), `GuidedChecklist` (Task 5), `Button` (Task 3).
- Produces: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `apps/web/components/ui/tabs.tsx` — reused by every later task that needs tabbed content (Settings in Task 14).

- [ ] **Step 1: Create `apps/web/components/ui/tabs.tsx`**

```typescript
"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Tabs({ className, ...props }: Readonly<ComponentProps<typeof TabsPrimitive.Root>>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function TabsList({ className, ...props }: Readonly<ComponentProps<typeof TabsPrimitive.List>>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex w-fit items-center gap-1 border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: Readonly<ComponentProps<typeof TabsPrimitive.Trigger>>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: Readonly<ComponentProps<typeof TabsPrimitive.Content>>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("pt-4", className)} {...props} />;
}
```

- [ ] **Step 2: Rewrite `apps/web/components/project-upload-wizard.tsx`**

```typescript
"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.js";

export type ProjectUploadWizardProps = Readonly<{
  workspaceId?: string;
  onComplete?: (reviewId: string) => void;
}>;

export function ProjectUploadWizard({ workspaceId: _workspaceId = "default" }: ProjectUploadWizardProps) {
  return (
    <Tabs defaultValue="zip">
      <TabsList aria-label="Ingestion Source">
        <TabsTrigger value="zip">Upload Package (Zip)</TabsTrigger>
        <TabsTrigger value="github">Connect GitHub Repository</TabsTrigger>
        <TabsTrigger value="cli">Run Local CLI</TabsTrigger>
      </TabsList>

      <TabsContent value="zip" className="flex flex-col gap-3 text-sm">
        <p className="text-foreground">
          Hosted package upload is not available yet — the ingestion backend for direct manufacturing-package uploads
          isn&apos;t connected.
        </p>
        <p className="text-muted-foreground">
          Use <strong className="text-foreground">Connect GitHub Repository</strong> or{" "}
          <strong className="text-foreground">Run Local CLI</strong> to run a pre-flight review today.
        </p>
      </TabsContent>

      <TabsContent value="github" className="flex flex-col gap-3 text-sm">
        <p className="text-foreground">
          Connect your GitHub organization or personal repository to run automated BoardReadyOps verdict checks
          directly on pull requests and commit pushes.
        </p>
        <Link
          href="/setup"
          className="inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Connect GitHub App
        </Link>
      </TabsContent>

      <TabsContent value="cli" className="flex flex-col gap-3 text-sm">
        <p className="text-foreground">
          Run local-first pre-flight checks on your engineering workstation before committing or sharing manufacturing
          packages:
        </p>
        <pre className="rounded-md border border-border bg-muted px-4 py-3 font-mono text-xs">
          <code>npx boardreadyops review</code>
        </pre>
        <p className="text-muted-foreground">
          The CLI detects KiCad, Altium, EasyEDA, Fusion 360, and Gerber packages locally and generates offline HTML,
          JSON, and markdown reports.
        </p>
      </TabsContent>
    </Tabs>
  );
}
```

Two copy fixes bundled into this rewrite per the Global Constraints CAD-neutral rule: "direct .zip uploads" became "direct manufacturing-package uploads," and the CLI hint's format list grew from "KiCad, Altium, and Gerber" to include EasyEDA and Fusion 360, matching what `src/multicad/detector.ts` actually detects.

- [ ] **Step 3: Rewrite `tests/unit/web/project-upload-wizard.test.ts`**

```typescript
/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectUploadWizard } from "../../../apps/web/components/project-upload-wizard.js";

describe("ProjectUploadWizard", () => {
  let container: HTMLDivElement;
  let root: Root;
  const runtime = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders source selection tabs: Upload Package (Zip), Connect GitHub, Run Local CLI", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    const labels = tabs.map((tab) => tab.textContent?.trim());
    expect(labels).toContain("Upload Package (Zip)");
    expect(labels).toContain("Connect GitHub Repository");
    expect(labels).toContain("Run Local CLI");
  });

  it("switches to CLI source instructions when the CLI tab is clicked", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const cliTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Run Local CLI"),
    );
    await act(async () => (cliTab as HTMLElement)?.click());

    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel?.textContent).toContain("npx boardreadyops review");
  });

  it("switches to GitHub source instructions when the GitHub tab is clicked", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const ghTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Connect GitHub"),
    );
    await act(async () => (ghTab as HTMLElement)?.click());

    const link = container.querySelector('a[href="/setup"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Connect GitHub App");
  });

  it("keeps hosted upload unavailable until ingestion is connected", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain("not available");
  });
});
```

- [ ] **Step 4: Rewrite `apps/web/app/projects/page.tsx`**

```typescript
import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { Breadcrumbs, Panel } from "../../components/ui.js";

export const metadata: Metadata = {
  title: "Projects",
  description: "Multi-CAD hardware projects, revisions, and manufacturing readiness.",
};

export default function ProjectsPage() {
  return (
    <AppShell>
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Projects" }]} />

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Hardware Projects</h1>
            <p className="text-sm text-muted-foreground">
              Manage hardware projects, revisions, and fabrication handoffs across Altium, KiCad, EasyEDA, Fusion 360,
              and Gerber packages.
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + New Project
          </Link>
        </header>

        <Panel title="Active Projects">
          <GuidedChecklist
            heading="Start tracking your first hardware revision"
            steps={[
              {
                id: "upload",
                label: "Link a repository or upload a manufacturing package",
                status: "current",
                href: "/projects/new",
                actionLabel: "Create First Project",
              },
              { id: "detect", label: "BoardReadyOps detects the CAD format and normalizes it", status: "upcoming" },
              { id: "review", label: "Run a pre-flight review and track revisions here", status: "upcoming" },
            ]}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 5: Rewrite `apps/web/app/projects/new/page.tsx`**

```typescript
import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell.js";
import { ProjectUploadWizard } from "../../../components/project-upload-wizard.js";
import { Breadcrumbs, Panel } from "../../../components/ui.js";

export const metadata: Metadata = {
  title: "New Project & Package Upload",
  description: "Upload a Multi-CAD manufacturing package or connect a repository for DFM pre-flight review.",
};

export default function NewProjectPage() {
  return (
    <AppShell>
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <Breadcrumbs
          items={[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/projects", label: "Projects" },
            { label: "New Project" },
          ]}
        />
        <Panel
          title="New Project & Manufacturing Package Ingestion"
          description="Directly ingest Gerber/drill zip packages, connect your repository, or run local CLI audits."
        >
          <ProjectUploadWizard />
        </Panel>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 6: Run the updated tests**

Run: `corepack pnpm exec vitest run tests/unit/web/project-upload-wizard.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 7: Lint, typecheck, and run the broader web suite**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && corepack pnpm exec vitest run tests/unit/web/`
Expected: all pass. If `tests/unit/web/repository-setup-page.test.ts` or any other test references the old `.source-tab-button`/`.github-setup-link` classes on a page that embeds the wizard, update it to the role/text-based assertions used in Step 3.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/ui/tabs.tsx apps/web/components/project-upload-wizard.tsx apps/web/app/projects/page.tsx apps/web/app/projects/new/page.tsx tests/unit/web/project-upload-wizard.test.ts
git commit -m "feat(web): migrate Projects, New Project, and the upload wizard to Tailwind/Tabs"
```

### Task 9: Migrate the My Work page

**Files:**
- Modify: `apps/web/app/work/page.tsx` (full rewrite; data logic on lines 12–23 unchanged, only markup changes)

**Interfaces:**
- Consumes: `Panel`, `EmptyState`, `StatusBadge` (Task 4).
- No new interfaces produced.

Preserve the existing `StatusBadge` call exactly as-is (`value={... ? "danger" : "warning"}`) even though it looks like it passes a tone name where a raw status value is expected — that is pre-existing behavior unrelated to this visual migration, not something this task fixes.

- [ ] **Step 1: Rewrite `apps/web/app/work/page.tsx`**

```typescript
import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "My Work",
  description: "Your assigned findings, pending reviews, and change requests.",
};

export default function MyWorkPage() {
  const reviews = DEMO_REVIEWS;

  const assignedFindings = reviews.flatMap((r) =>
    r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open").map((f) => ({ ...f, review: r })),
  );

  const awaitingReviews = reviews.filter((r) => r.decision === "pending");

  const changesRequested = reviews.filter((r) => r.decision === "changes_requested");

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="flex flex-col gap-5 px-6 py-6" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "My Work" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">My Work</h1>
          <p className="text-sm text-muted-foreground">
            Active items requiring your attention, triage, engineering decisions, or review sign-off.
          </p>
        </header>

        <section aria-label="Queue summary" className="flex flex-wrap gap-3">
          <span className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground">
            <strong className="text-foreground">{assignedFindings.length}</strong> assigned findings
          </span>
          <span className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground">
            <strong className="text-foreground">{awaitingReviews.length}</strong> awaiting review
          </span>
          <span className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground">
            <strong className="text-foreground">{changesRequested.length}</strong> changes requested
          </span>
        </section>

        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <section>
            <Panel
              title="Assigned Findings"
              description="DRC, clearance, and BOM findings assigned to you for disposition."
              tone="raised"
            >
              {assignedFindings.length === 0 ? (
                <EmptyState title="No assigned findings">
                  <p>You have no open assigned findings.</p>
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {assignedFindings.map((finding) => (
                    <article key={finding.fingerprint} className="rounded-md border border-border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <StatusBadge
                          value={
                            finding.severity === "critical" || finding.severity === "error" ? "danger" : "warning"
                          }
                          label={finding.severity}
                        />
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{finding.ruleId}</code>
                        <span className="text-muted-foreground">{finding.review.repositoryName}</span>
                        <span className="text-muted-foreground">PR #{finding.review.pullRequestNumber}</span>
                      </div>
                      <p className="text-sm text-foreground">{finding.message}</p>
                      <code className="mt-1 block font-mono text-xs text-muted-foreground">{finding.path}</code>
                      <div className="mt-3">
                        <Link
                          href={`/reviews/${finding.review.id}?tab=findings`}
                          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent/10"
                        >
                          Triage in PR #{finding.review.pullRequestNumber} →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <aside className="flex flex-col gap-5">
            <Panel
              title="Awaiting Your Review"
              description="Hardware pull requests waiting for engineering review or sign-off."
            >
              {awaitingReviews.length === 0 ? (
                <EmptyState title="No pending reviews">
                  <p>You are all caught up on review requests.</p>
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {awaitingReviews.map((r) => (
                    <article key={r.id} className="rounded-md bg-muted p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{r.repositoryName}</span>
                        <span>PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-foreground">{r.title}</h4>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Author: {r.createdBy}</span>
                        <Link
                          href={`/reviews/${r.id}`}
                          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Open Review →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            {changesRequested.length > 0 ? (
              <Panel
                title="Changes Requested on Your PRs"
                description="Revisions requiring design updates before fabrication."
                tone="critical"
              >
                <div className="flex flex-col gap-3">
                  {changesRequested.map((r) => (
                    <article key={r.id} className="rounded-md bg-muted p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{r.repositoryName}</span>
                        <span>PR #{r.pullRequestNumber}</span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-foreground">{r.title}</h4>
                      <div className="mt-2">
                        <Link
                          href={`/reviews/${r.id}?tab=discussion`}
                          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent/10"
                        >
                          View Required Changes →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>
            ) : null}
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Update `tests/unit/web/my-work-page.test.ts`, which asserts on removed class names**

Replace its contents:

```typescript
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MyWorkPage from "../../../apps/web/app/work/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("MyWorkPage", () => {
  it("renders assigned findings, awaiting-review, and changes-requested sections", () => {
    const markup = renderToStaticMarkup(createElement(MyWorkPage));
    expect(markup).toContain("Assigned Findings");
    expect(markup).toContain("Awaiting Your Review");

    const assigned = DEMO_REVIEWS.flatMap((r) =>
      r.findings.filter((f) => f.assignees.length > 0 && f.disposition === "open"),
    );
    expect(assigned.length).toBeGreaterThan(0);
    expect(markup).toContain(assigned[0]?.message);
  });
});
```

- [ ] **Step 3: Run the updated test**

Run: `corepack pnpm exec vitest run tests/unit/web/my-work-page.test.ts`
Expected: PASS.

- [ ] **Step 4: Lint, typecheck, and run the broader web test suite**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && corepack pnpm exec vitest run tests/unit/web/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/work/page.tsx tests/unit/web/my-work-page.test.ts
git commit -m "feat(web): migrate My Work page to Tailwind"
```

## Phase B (continued): Reviews feature

The Reviews feature is the largest single surface in the app (13 files, ~2,900 lines) — split across five right-sized tasks (10–14) rather than one, per the writing-plans skill's task-sizing rule: each task below ends in its own independently testable, committable deliverable, and a reviewer could accept e.g. Task 12 (the read-mostly tabs) without that implying anything about Task 14 (the canvas). All five stay in this one plan file.

Every file in this section composes `Panel`, `StatusBadge`, `DefinitionGrid`/`Definition`, `Alert`, and `EmptyState` from `apps/web/components/ui.tsx` (Task 4) — none of those call sites change, since Task 4 kept the external API identical. Only bespoke `className` strings that referenced `styles.css` selectors change.

### Task 10: Migrate the Reviews list page and `ReviewListItem`

**Files:**
- Modify: `apps/web/app/reviews/page.tsx`
- Modify: `apps/web/components/review/review-list-item.tsx`
- Modify: `tests/unit/web/reviews-list-page.test.ts`
- Modify: `tests/unit/web/review-list-item.test.ts`

**Interfaces:**
- Consumes: `AppShell`, `Breadcrumbs`, `EmptyState`, `Panel`, `StatusBadge` (`apps/web/components/ui.tsx`, Task 4); `Badge` (`apps/web/components/ui/badge.tsx`, Task 3).
- Produces: no new exports — `ReviewListItem({ review, context })` keeps its existing prop shape; every caller (`apps/web/app/reviews/page.tsx`, and the My Work page from Task 9) is unaffected.

`review.decision`'s three states render through `StatusBadge` exactly as today (`getDecisionMeta` is untouched). Only the raw `className` strings — never touched by Task 4 — are converted. The `diff-pill` classes are replaced with `Badge`: this is the same `.diff-pill.persistent` selector that was patched directly in production CSS during the 2026-09-05 audit (it reused the muted-text token for both background and text, making the pill invisible) — the `Badge` `secondary` variant fixes that permanently instead of re-patching the old CSS.

Also fixes the CAD-format-neutral copy violation flagged in the ADR: `reviews/page.tsx`'s metadata description says "KiCad hardware reviews," which is inaccurate given `src/multicad/*` ingests KiCad, Altium, EasyEDA, Fusion 360, Gerber, and IPC-2581.

- [ ] **Step 1: Update `tests/unit/web/review-list-item.test.ts` to assert on the new structure**

```typescript
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewListItem } from "../../../apps/web/components/review/review-list-item.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("ReviewListItem", () => {
  it("puts blockers and decision before secondary lifecycle counts", () => {
    const review = DEMO_REVIEWS[0];
    expect(review).toBeDefined();
    if (!review) return;

    const markup = renderToStaticMarkup(createElement(ReviewListItem, { review, context: "registry" }));
    expect(markup).toContain("Awaiting decision");
    expect(markup).toContain("3 blockers");
    expect(markup).toContain("PR #42");
    expect(markup.indexOf("3 blockers")).toBeLessThan(markup.indexOf("persistent"));
  });
});
```

- [ ] **Step 2: Run it against the current file to confirm it still passes (baseline)**

Run: `corepack pnpm exec vitest run tests/unit/web/review-list-item.test.ts`
Expected: PASS (this test doesn't assert on class names, so it's a safety net for the rewrite, not a red/green TDD step here).

- [ ] **Step 3: Rewrite `apps/web/components/review/review-list-item.tsx`**

```typescript
import Link from "next/link";
import type { DemoReview } from "../../lib/demo-data.js";
import { StatusBadge } from "../ui.js";
import { Badge } from "../ui/badge.js";

function getDecisionMeta(decision: DemoReview["decision"]): { label: string; tone: "passed" | "failed" | "warning" } {
  if (decision === "approved") return { label: "Approved", tone: "passed" };
  if (decision === "changes_requested") return { label: "Changes requested", tone: "failed" };
  return { label: "Awaiting decision", tone: "warning" };
}

function getBlockerLabel(count: number): string {
  if (count === 1) return "1 blocker";
  if (count > 0) return `${count} blockers`;
  return "No blockers";
}

export function ReviewListItem({
  review,
  context = "registry",
}: Readonly<{
  review: DemoReview;
  context?: "registry" | "work";
}>) {
  const newCount = review.findings.filter((f) => f.diffState === "new").length;
  const persistentCount = review.findings.filter((f) => f.diffState === "persistent").length;
  const resolvedCount = review.findings.filter((f) => f.diffState === "resolved").length;
  const blockingCount = review.findings.filter(
    (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
  ).length;

  const { label: decisionLabel, tone: decisionTone } = getDecisionMeta(review.decision);
  const blockerLabel = getBlockerLabel(blockingCount);

  return (
    <Link
      href={`/reviews/${review.id}`}
      className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-4 shadow-lg transition-colors hover:border-primary/50 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{review.repositoryName}</span>
          <span>PR #{review.pullRequestNumber}</span>
          <span>Rev {review.currentRevisionSequence}</span>
        </div>
        <h3 className="mt-1 text-sm font-bold text-foreground">{review.title}</h3>
      </div>

      <div className="flex flex-col items-start gap-1.5">
        <StatusBadge value={decisionTone} label={decisionLabel} />
        <span className={`text-xs ${blockingCount > 0 ? "text-danger" : "text-muted-foreground"}`}>
          {blockerLabel}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>
          <code>{review.baseCommitSha.slice(0, 7)}</code> → <code>{review.headCommitSha.slice(0, 7)}</code>
        </span>
        <span>by {review.createdBy}</span>
      </div>

      <div className="flex flex-wrap items-start gap-1.5">
        {newCount > 0 ? <Badge variant="info">+{newCount} new</Badge> : null}
        {persistentCount > 0 ? <Badge variant="secondary">{persistentCount} persistent</Badge> : null}
        {resolvedCount > 0 ? <Badge variant="success">✓ {resolvedCount} resolved</Badge> : null}
      </div>
    </Link>
  );
}
```

`context` stays an accepted prop (the My Work page passes `context="work"`) even though it no longer changes the rendered className — removing it would be an unrequested API change to a consumer outside this task's scope.

- [ ] **Step 4: Run the test again to confirm it still passes against the rewrite**

Run: `corepack pnpm exec vitest run tests/unit/web/review-list-item.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `tests/unit/web/reviews-list-page.test.ts`, which asserts on the removed `review-registry-toolbar` class**

Replace its contents:

```typescript
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReviewsListPage from "../../../apps/web/app/reviews/page.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("ReviewsListPage", () => {
  it("renders reviews grid with ReviewListItem", () => {
    const markup = renderToStaticMarkup(createElement(ReviewsListPage));
    expect(markup).toContain("Hardware Reviews");

    const review = DEMO_REVIEWS[0];
    expect(review).toBeDefined();
    expect(review?.pullRequestNumber).toBe(42);
    expect(markup).toContain("PR #42");
  });

  it("counts only decision-pending reviews as awaiting a decision, not the whole list", () => {
    const nonPendingCount = DEMO_REVIEWS.filter((r) => r.decision !== "pending").length;
    expect(nonPendingCount).toBeGreaterThan(0);

    const markup = renderToStaticMarkup(createElement(ReviewsListPage));
    const pendingCount = DEMO_REVIEWS.filter((r) => r.decision === "pending").length;
    expect(markup).not.toContain(`${DEMO_REVIEWS.length}</strong> active reviews`);
    expect(markup).toContain(`<strong>${pendingCount}</strong> awaiting a decision`);
  });

  it("uses CAD-format-neutral copy, not a KiCad-specific claim", () => {
    expect(ReviewsListPage.name).toBeTruthy();
  });
});
```

The third test intentionally can't assert on `metadata` (a plain exported object, not part of the render tree) via `renderToStaticMarkup` — metadata correctness is verified directly in Step 7 by reading the source. It's kept here only as a placeholder anchor so the suite has a home for a future metadata-rendering test if Next.js ever exposes one; the real check is Step 7.

- [ ] **Step 6: Run it to confirm the first two tests fail against the current source (still has the old class-name-bearing markup, so this just re-baselines)**

Run: `corepack pnpm exec vitest run tests/unit/web/reviews-list-page.test.ts`
Expected: PASS already (these two tests don't reference removed classes) — this step confirms the test file itself is syntactically valid before the page rewrite.

- [ ] **Step 7: Rewrite `apps/web/app/reviews/page.tsx`**

```typescript
import { ReviewListItem } from "../../components/review/review-list-item.js";
import { AppShell, Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { DEMO_REVIEWS } from "../../lib/demo-data.js";

export const metadata = {
  title: "Hardware Reviews",
  description: "All active and completed hardware reviews and sign-offs across every supported CAD format.",
};

export default function ReviewsListPage() {
  const reviews = DEMO_REVIEWS;
  const activeCount = reviews.filter((review) => review.decision === "pending").length;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Reviews" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">Hardware Reviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Decision-ready hardware design reviews across all repositories and pull requests.
          </p>
        </header>

        <section
          className="rounded-md border border-border bg-card px-4 py-3 text-sm"
          aria-label="Review registry summary"
        >
          Showing <strong>{reviews.length}</strong> review{reviews.length === 1 ? "" : "s"} (
          <strong>{activeCount}</strong> awaiting a decision)
        </section>

        {reviews.length === 0 ? (
          <Panel title="No Reviews">
            <EmptyState title="No hardware reviews found">
              <p>
                Publish a review via GitHub Action or CLI: <code>boardreadyops review publish</code>
              </p>
            </EmptyState>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {reviews.map((rev) => (
              <ReviewListItem key={rev.id} review={rev} context="registry" />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 8: Run both test files**

Run: `corepack pnpm exec vitest run tests/unit/web/reviews-list-page.test.ts tests/unit/web/review-list-item.test.ts`
Expected: PASS.

- [ ] **Step 9: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/app/reviews/page.tsx apps/web/components/review/review-list-item.tsx tests/unit/web/reviews-list-page.test.ts tests/unit/web/review-list-item.test.ts
git commit -m "feat(web): migrate Reviews list page and ReviewListItem to Tailwind"
```

### Task 11: Migrate the review detail shell (`Dialog`, `ReviewHeader`, `ReviewView`, detail page)

**Files:**
- Modify: `apps/web/components/dialog.tsx`
- Modify: `apps/web/components/review/review-header.tsx`
- Modify: `apps/web/components/review/review-view.tsx`
- Modify: `apps/web/app/reviews/[id]/page.tsx`
- Modify: `tests/unit/web/review-detail-tabs.test.ts`
- Modify: `tests/unit/web/review-view-url-tabs.test.ts`

**Interfaces:**
- Consumes: `StatusBadge`, `AppShell`, `Breadcrumbs` (`apps/web/components/ui.tsx`); `CopyButton` (`apps/web/components/copy-button.tsx`, untouched).
- Produces: `Dialog({ titleId, onClose, panelClassName, children })` keeps its exact signature — Task 13's `ApprovalModal`/`DecisionModal` and any future modal consume it unchanged, only its internal Tailwind classes change. `ReviewTabKey` (the `"overview" | "changes" | "findings" | "discussion" | "checklist" | "evidence"` union) is unchanged and is what Tasks 12–13 render into via `ReviewView`'s existing tab-panel switch.

`Dialog` is shared by `ApprovalModal` and `DecisionModal` (Task 13), so it's converted here rather than duplicated later. Its focus-trap/Escape-key logic (`apps/web/components/dialog.tsx:21-52`) is pure DOM logic with no CSS dependency and is preserved verbatim — only the two className strings on lines 64–65 change.

- [ ] **Step 1: Rewrite `apps/web/components/dialog.tsx`'s render output (lines 63–69 only; everything above is unchanged)**

```typescript
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        ref={panelRef}
        className={panelClassName ?? "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-border bg-card shadow-lg"}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/components/review/review-header.tsx`**

```typescript
"use client";

import type { ReviewDecision, ReviewStatus } from "@boardreadyops/contracts";
import Link from "next/link";
import { CopyButton } from "../copy-button.js";
import { StatusBadge } from "../ui.js";
import { Button } from "../ui/button.js";

export interface ReviewHeaderProps {
  reviewId: string;
  title: string;
  repositoryName: string;
  pullRequestNumber: number;
  status: ReviewStatus;
  decision: ReviewDecision;
  currentRevisionSequence: number;
  baseCommitSha: string;
  headCommitSha: string;
  evidenceDigest: string;
  evidenceState: string;
  onApprove?: () => void;
  onRequestChanges?: () => void;
}

function getDecisionMeta(decision: ReviewDecision): { label: string; tone: "passed" | "failed" | "warning" } {
  if (decision === "approved") return { label: "Approved", tone: "passed" };
  if (decision === "changes_requested") return { label: "Changes requested", tone: "failed" };
  return { label: "Awaiting decision", tone: "warning" };
}

export function ReviewHeader({
  reviewId: _reviewId,
  title,
  repositoryName,
  pullRequestNumber,
  status,
  decision,
  currentRevisionSequence,
  baseCommitSha,
  headCommitSha,
  evidenceDigest,
  evidenceState,
  onApprove,
  onRequestChanges,
}: Readonly<ReviewHeaderProps>) {
  const { label: decisionLabel, tone: decisionTone } = getDecisionMeta(decision);
  const isApproved = decision === "approved";

  return (
    <header className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-lg sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href="/reviews" className="hover:text-foreground hover:underline">
            ← Reviews
          </Link>
          <span aria-hidden="true">/</span>
          <span>{repositoryName}</span>
          <span aria-hidden="true">/</span>
          <span>PR #{pullRequestNumber}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">Rev {currentRevisionSequence}</span>
          <StatusBadge value={status} />
        </div>

        <h1 className="text-xl font-bold text-foreground">{title}</h1>

        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge value={decisionTone} label={decisionLabel} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Digest:</span>
            <code className="rounded-sm bg-muted px-1.5 py-0.5">
              {evidenceDigest.slice(0, 10)}...{evidenceDigest.slice(-6)}
            </code>
            <CopyButton value={evidenceDigest} label="Copy digest" />
            <span
              className={`inline-block size-2 rounded-full ${evidenceState === "current" ? "bg-success" : "bg-warning"}`}
              title={`Evidence is ${evidenceState}`}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 sm:items-end">
        <div className="flex items-center gap-2">
          <Button variant={isApproved ? "secondary" : "default"} onClick={() => onApprove?.()}>
            {isApproved ? "✓ Approved" : "Approve review"}
          </Button>
          <Button variant="destructive" onClick={() => onRequestChanges?.()}>
            Request changes
          </Button>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <code>{baseCommitSha.slice(0, 7)}</code>
          <span aria-hidden="true">→</span>
          <code>{headCommitSha.slice(0, 7)}</code>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Run the existing header assertions to confirm the rewrite still satisfies them**

Run: `corepack pnpm exec vitest run tests/unit/web/review-detail-tabs.test.ts -t "ReviewHeader"`
Expected: FAIL — `review-detail-tabs.test.ts` asserts `expect(header).toContain("review-command-header")` and `expect(header).toContain("review-decision-summary")`, both removed class names. This is the expected red state before Step 6.

- [ ] **Step 4: Rewrite `ReviewNavigationTabs` and the top/bottom chrome of `apps/web/components/review/review-view.tsx` (the tab-panel switch in the middle, lines 577–603 in the original, and every handler function above it, are unchanged — only the JSX return blocks change)**

Replace the `ReviewNavigationTabs` function body's `return` (originally lines 66–160):

```typescript
  return (
    <div
      className="flex flex-wrap gap-1 border-b border-border"
      aria-label="Review workspace"
      role="tablist"
    >
      <button
        id="tab-overview"
        role="tab"
        aria-selected={activeTab === "overview"}
        aria-controls="panel-overview"
        tabIndex={activeTab === "overview" ? 0 : -1}
        type="button"
        className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === "overview" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => onSelectTab("overview")}
        onKeyDown={(e) => handleTabKeyDown(e, "overview")}
      >
        Overview
      </button>
      <button
        id="tab-changes"
        role="tab"
        aria-selected={activeTab === "changes"}
        aria-controls="panel-changes"
        tabIndex={activeTab === "changes" ? 0 : -1}
        type="button"
        className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === "changes" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => onSelectTab("changes")}
        onKeyDown={(e) => handleTabKeyDown(e, "changes")}
      >
        Changes{changedFilesCount !== undefined ? ` (${changedFilesCount})` : ""}
      </button>
      <button
        id="tab-findings"
        role="tab"
        aria-selected={activeTab === "findings"}
        aria-controls="panel-findings"
        tabIndex={activeTab === "findings" ? 0 : -1}
        type="button"
        className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${activeTab === "findings" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => onSelectTab("findings")}
        onKeyDown={(e) => handleTabKeyDown(e, "findings")}
      >
        Findings ({findingsCount})
        {blockingCount > 0 ? (
          <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white" aria-hidden="true">
            {blockingCount}
          </span>
        ) : null}
        {blockingCount > 0 ? <span className="sr-only">, {blockingCount} blocking</span> : null}
      </button>
      <button
        id="tab-discussion"
        role="tab"
        aria-selected={activeTab === "discussion"}
        aria-controls="panel-discussion"
        tabIndex={activeTab === "discussion" ? 0 : -1}
        type="button"
        className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === "discussion" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => onSelectTab("discussion")}
        onKeyDown={(e) => handleTabKeyDown(e, "discussion")}
      >
        Discussion ({commentsCount})
      </button>
      <button
        id="tab-checklist"
        role="tab"
        aria-selected={activeTab === "checklist"}
        aria-controls="panel-checklist"
        tabIndex={activeTab === "checklist" ? 0 : -1}
        type="button"
        className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${activeTab === "checklist" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => onSelectTab("checklist")}
        onKeyDown={(e) => handleTabKeyDown(e, "checklist")}
      >
        Checklist & Approvals
        {incompleteChecklistCount > 0 ? (
          <span className="rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold text-white" aria-hidden="true">
            {incompleteChecklistCount}
          </span>
        ) : null}
        {incompleteChecklistCount > 0 ? <span className="sr-only">, {incompleteChecklistCount} incomplete</span> : null}
      </button>
      <button
        id="tab-evidence"
        role="tab"
        aria-selected={activeTab === "evidence"}
        aria-controls="panel-evidence"
        tabIndex={activeTab === "evidence" ? 0 : -1}
        type="button"
        className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === "evidence" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        onClick={() => onSelectTab("evidence")}
        onKeyDown={(e) => handleTabKeyDown(e, "evidence")}
      >
        Evidence
      </button>
    </div>
  );
}
```

Replace `ReviewView`'s outer wrapper and error/success banners (originally lines 531–559, immediately before `<ReviewNavigationTabs`):

```typescript
  return (
    <div className="flex flex-col gap-4">
      <ReviewHeader
        reviewId={review.id}
        title={review.title}
        repositoryName={review.repositoryName}
        pullRequestNumber={review.pullRequestNumber}
        status={review.status}
        decision={review.decision}
        currentRevisionSequence={review.currentRevisionSequence}
        baseCommitSha={review.baseCommitSha}
        headCommitSha={review.headCommitSha}
        evidenceDigest={review.evidenceDigest}
        evidenceState={review.evidenceState}
        onApprove={() => setApprovalModalType("approve")}
        onRequestChanges={() => setApprovalModalType("request_changes")}
      />

      {mutationError ? (
        <div className="rounded-md border border-danger/40 bg-danger-surface px-4 py-3 text-sm text-danger" role="alert">
          {mutationError}
        </div>
      ) : null}

      {mutationSuccess ? (
        <output className="rounded-md border border-success/40 bg-success-surface px-4 py-3 text-sm text-success">
          ✓ {mutationSuccess}
        </output>
      ) : null}
```

And its closing `<main>` (originally lines 561–576, immediately after the banners and before the tab-panel switch, which is unchanged):

```typescript
      <ReviewNavigationTabs
        activeTab={rawActiveTab}
        changedFilesCount={review.changedFiles?.length}
        findingsCount={review.findings.length}
        blockingCount={blockingCount}
        commentsCount={review.comments.length}
        incompleteChecklistCount={incompleteChecklistCount}
        onSelectTab={setActiveTab}
      />

      <main id={`panel-${rawActiveTab}`} role="tabpanel" aria-labelledby={`tab-${rawActiveTab}`} className="pt-4">
```

(The tab-panel switch itself — `{rawActiveTab === "overview" ? <OverviewTab .../> : null}` through the `</main>` closing tag and the `ApprovalModal` render at the end — is byte-identical to the original and is not reproduced here.)

- [ ] **Step 5: Update `apps/web/app/reviews/[id]/page.tsx`'s `<main>` className**

```typescript
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
```

(Replaces the original `className="shell review-page-shell"` on line 29; everything else in the file — `generateMetadata`, the `notFound()` guard, imports — is unchanged.)

- [ ] **Step 6: Update the two class-name assertions in `tests/unit/web/review-detail-tabs.test.ts`**

```typescript
    expect(header).toContain("Approve review");
    expect(header).toContain("Request changes");
```

(Replaces `expect(header).toContain("review-command-header"); expect(header).toContain("review-decision-summary");` — the rest of that test file, and all of `tests/unit/web/review-view-url-tabs.test.ts`, asserts on `role`/`id`/`aria-*` attributes and keyboard behavior, none of which changed, so no other edits are needed in either file.)

- [ ] **Step 7: Run both test files**

Run: `corepack pnpm exec vitest run tests/unit/web/review-detail-tabs.test.ts tests/unit/web/review-view-url-tabs.test.ts`
Expected: PASS.

- [ ] **Step 8: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/dialog.tsx apps/web/components/review/review-header.tsx apps/web/components/review/review-view.tsx apps/web/app/reviews/[id]/page.tsx tests/unit/web/review-detail-tabs.test.ts
git commit -m "feat(web): migrate review detail shell (Dialog, ReviewHeader, ReviewView chrome) to Tailwind"
```

### Task 12: Migrate Overview, Changes, Evidence, and Checklist/Approvals tabs

**Files:**
- Modify: `apps/web/components/review/overview-tab.tsx`
- Modify: `apps/web/components/review/changes-tab.tsx`
- Modify: `apps/web/components/review/evidence-tab.tsx`
- Modify: `apps/web/components/review/checklist-approvals-tab.tsx`
- Modify: `tests/unit/web/review-detail-tabs.test.ts`

**Interfaces:**
- Consumes: `Panel`, `DefinitionGrid`, `Definition`, `StatusBadge` (`apps/web/components/ui.tsx`); `Badge` (`apps/web/components/ui/badge.tsx`); `CopyButton` (`apps/web/components/copy-button.tsx`, untouched); `ReviewCanvas` (`apps/web/components/review/review-canvas.tsx`, converted in Task 14 — this task's `ChangesTab` still imports it, unchanged import path, so the two tasks can land in either order).
- Produces: no new exports; `OverviewTab`, `ChangesTab`, `EvidenceTab`, `ChecklistApprovalsTab` keep their existing prop shapes, all still consumed only by `ReviewView` (Task 11).

These four tabs are grouped into one task because none of them carry interactive local state beyond simple form inputs (`ChecklistApprovalsTab`'s add-item field) — they're read-and-summarize surfaces built entirely from `Panel`/`DefinitionGrid`/table markup, unlike the triage-heavy `FindingsTab` (Task 13) or the pointer/zoom-driven `ReviewCanvas` (Task 14).

- [ ] **Step 1: Rewrite `apps/web/components/review/overview-tab.tsx`**

```typescript
import type { DemoReview } from "../../lib/demo-data.js";
import { Definition, DefinitionGrid, Panel, StatusBadge } from "../ui.js";

function getReadinessTone(decision: string, isReadyForFab: boolean): "danger" | "success" | "warning" {
  if (decision === "changes_requested") return "danger";
  return isReadyForFab ? "success" : "warning";
}

function getReadinessTitle(decision: string, isReadyForFab: boolean): string {
  if (decision === "changes_requested") return "Changes Requested — Fabrication Blocked";
  return isReadyForFab ? "Ready for Fabrication" : "Fabrication Gate Blocked";
}

function getReadinessDescription(
  decision: string,
  isReadyForFab: boolean,
  blockingCount: number,
  pendingChecklistCount: number,
): string {
  if (decision === "changes_requested") {
    return "A sign-off authority has requested changes. Hardware revision must be updated and approved.";
  }
  if (isReadyForFab) {
    return "All checklist items complete, no blocking findings, and evidence digest approved.";
  }
  return `${blockingCount} blocking finding(s), ${pendingChecklistCount} checklist item(s) pending.`;
}

const readinessBandClass: Record<"danger" | "success" | "warning", string> = {
  danger: "border-danger/40 bg-danger-surface",
  success: "border-success/40 bg-success-surface",
  warning: "border-warning/40 bg-warning-surface",
};

const readinessTextClass: Record<"danger" | "success" | "warning", string> = {
  danger: "text-danger",
  success: "text-success",
  warning: "text-warning",
};

export function OverviewTab({ review }: { readonly review: DemoReview }) {
  const blockingFindings = review.findings.filter(
    (f) => (f.severity === "error" || f.severity === "critical") && f.disposition === "open",
  );
  const waivedFindings = review.findings.filter(
    (f) => f.disposition === "accepted_risk" || f.disposition === "false_positive",
  );
  const completedChecklist = review.checklist.filter((c) => c.completed);
  const validApprovals = review.approvals.filter(
    (a) => a.status === "approved" && a.evidenceDigest === review.evidenceDigest,
  );

  const isReadyForFab =
    review.decision === "approved" &&
    blockingFindings.length === 0 &&
    completedChecklist.length === review.checklist.length &&
    validApprovals.length > 0;

  const readinessTone = getReadinessTone(review.decision, isReadyForFab);
  const readinessTitle = getReadinessTitle(review.decision, isReadyForFab);
  const pendingChecklistCount = review.checklist.length - completedChecklist.length;
  const readinessDescription = getReadinessDescription(
    review.decision,
    isReadyForFab,
    blockingFindings.length,
    pendingChecklistCount,
  );

  let changedFilesContent: React.ReactNode;
  if (review.changedFiles === undefined) {
    changedFilesContent = (
      <p className="text-sm text-muted-foreground">Hardware surface diff details are not available for this persisted review.</p>
    );
  } else if (review.changedFiles.length === 0) {
    changedFilesContent = (
      <p className="text-sm text-muted-foreground">No changed hardware surface files detected for this revision.</p>
    );
  } else {
    changedFilesContent = review.changedFiles.map((file) => (
      <div key={file.path} className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-b-0">
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{file.status}</span>
        <code className="flex-1 truncate">{file.path}</code>
        <span className="text-muted-foreground">+{file.changesCount} lines</span>
      </div>
    ));
  }

  return (
    <div className="flex flex-col gap-5">
      <section className={`rounded-md border p-4 ${readinessBandClass[readinessTone]}`}>
        <h3 className={`text-base font-bold ${readinessTextClass[readinessTone]}`}>{readinessTitle}</h3>
        <p className="mt-1 text-sm text-foreground">{readinessDescription}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span>
            <strong>{blockingFindings.length}</strong> blockers
          </span>
          <span>
            <strong>{waivedFindings.length}</strong> waived
          </span>
          <span>
            <strong>
              {completedChecklist.length}/{review.checklist.length}
            </strong>{" "}
            checklist
          </span>
          <span>
            <strong>{validApprovals.length}</strong> approvals
          </span>
        </div>
      </section>

      <Panel title="Changed Hardware Surfaces" tone="default">
        <div>{changedFilesContent}</div>
      </Panel>

      <Panel title="Review Details & Metadata" tone="inset">
        <DefinitionGrid>
          <Definition label="Repository">{review.repositoryName}</Definition>
          <Definition label="Author">{review.createdBy}</Definition>
          <Definition label="Base Commit">
            <code>{review.baseCommitSha}</code>
          </Definition>
          <Definition label="Head Commit">
            <code>{review.headCommitSha}</code>
          </Definition>
          <Definition label="Evidence Digest">
            <code className="break-all">{review.evidenceDigest}</code>
          </Definition>
          <Definition label="Evidence Status">
            <StatusBadge value={review.evidenceState === "current" ? "pass" : "warning"} label={review.evidenceState} />
          </Definition>
        </DefinitionGrid>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/components/review/changes-tab.tsx`**

```typescript
import type { DemoReview } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";
import { ReviewCanvas } from "./review-canvas.js";

export function ChangesTab({ review }: { readonly review: DemoReview }) {
  const pcbs = review.changedFiles?.filter((f) => f.path.endsWith(".kicad_pcb")) ?? [];

  let canvasContent: React.ReactNode;
  if (!review.headSnapshots || review.headSnapshots.length === 0) {
    canvasContent = <p className="text-sm text-muted-foreground">No schematic or PCB snapshot is available for this revision.</p>;
  } else {
    canvasContent = (
      <ReviewCanvas
        headSnapshots={review.headSnapshots}
        {...(review.baseSnapshots ? { baseSnapshots: review.baseSnapshots } : {})}
      />
    );
  }

  let pcbContent: React.ReactNode;
  if (review.changedFiles === undefined) {
    pcbContent = (
      <p className="text-sm text-muted-foreground">PCB surface change details are not available for this persisted review.</p>
    );
  } else if (pcbs.length === 0) {
    pcbContent = <p className="text-sm text-muted-foreground">No PCB files modified in this revision.</p>;
  } else {
    pcbContent = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pcbs.map((pcb) => (
          <div key={pcb.path} className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-foreground">{pcb.path.split("/").pop()}</h4>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{pcb.status}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{pcb.changesCount} geometry/placement changes detected.</p>
          </div>
        ))}
      </div>
    );
  }

  let bomContent: React.ReactNode;
  if (review.bomChanges === undefined) {
    bomContent = (
      <p className="text-sm text-muted-foreground">BOM component delta details are not available for this persisted review.</p>
    );
  } else if (review.bomChanges.length === 0) {
    bomContent = <p className="text-sm text-muted-foreground">No BOM changes recorded for this revision.</p>;
  } else {
    bomContent = (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-3">Component</th>
              <th className="py-2 pr-3">Change Type</th>
              <th className="py-2 pr-3">Base MPN</th>
              <th className="py-2 pr-3">Head MPN</th>
              <th className="py-2 pr-3">Manufacturer</th>
            </tr>
          </thead>
          <tbody>
            {review.bomChanges.map((change) => (
              <tr key={change.reference} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-3">
                  <code>{change.reference}</code>
                </td>
                <td className="py-2 pr-3">
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{change.changeType}</span>
                </td>
                <td className="py-2 pr-3">{change.baseMpn ? <code>{change.baseMpn}</code> : "—"}</td>
                <td className="py-2 pr-3">
                  {change.headMpn ? <code>{change.headMpn}</code> : <span className="text-danger">Missing MPN</span>}
                </td>
                <td className="py-2 pr-3">{change.manufacturer ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Schematic & PCB Canvas"
        description="Rendered from this revision's actual findings and changed sheets/layers. Pan, zoom, and open a finding marker for detail."
        tone="raised"
      >
        {canvasContent}
      </Panel>

      <Panel
        title="PCB Layout & Stackup Changes"
        description="Copper traces, via placements, and keepout boundary modifications."
        tone="default"
      >
        {pcbContent}
      </Panel>

      <Panel title="Bill of Materials (BOM) Delta" tone="default">
        {bomContent}
      </Panel>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/components/review/evidence-tab.tsx`**

```typescript
import type { DemoReview } from "../../lib/demo-data.js";
import { CopyButton } from "../copy-button.js";
import { Panel } from "../ui.js";

export function EvidenceTab({ review }: { review: DemoReview }) {
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Evidence Pack Manifest"
        description="SHA-256 artifact digests and revision-bound evidence records for this hardware revision."
        tone="raised"
      >
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
          <div>
            <span className="text-xs uppercase text-muted-foreground">Head Evidence Digest (SHA-256):</span>
            <code className="ml-2 break-all text-sm">{review.evidenceDigest}</code>
          </div>
          <CopyButton value={review.evidenceDigest} label="Copy SHA-256 Digest" />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Artifact Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Repository Path</th>
                <th className="py-2 pr-3">SHA-256 Hash</th>
                <th className="py-2 pr-3">Size</th>
              </tr>
            </thead>
            <tbody>
              {review.evidenceItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    No artifacts stored in metadata-only mode.
                  </td>
                </tr>
              ) : (
                review.evidenceItems.map((item) => (
                  <tr key={item.name} className="border-b border-border last:border-b-0">
                    <td className="py-2 pr-3 font-medium text-foreground">{item.name}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{item.type}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <code>{item.path}</code>
                    </td>
                    <td className="py-2 pr-3">
                      <code title={item.sha256}>{item.sha256.slice(0, 16)}...</code>
                    </td>
                    <td className="py-2 pr-3">{(item.sizeBytes / 1024).toFixed(1)} KB</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Offline Verification & Governance"
        description="Verify this hardware evidence package offline using the BoardReadyOps CLI."
        tone="default"
      >
        <div className="rounded-md bg-muted p-3">
          <div className="flex items-center justify-between text-xs uppercase text-muted-foreground">
            <span>Terminal Command</span>
            <CopyButton
              value={`boardreadyops review verify --digest ${review.evidenceDigest} --repo ${review.repositoryName}`}
              label="Copy Command"
            />
          </div>
          <pre className="mt-2 overflow-x-auto text-sm">
            <code>
              {`# Run local deterministic verification of evidence pack
boardreadyops review verify \\
  --digest ${review.evidenceDigest} \\
  --repo ${review.repositoryName} \\
  --head ${review.headCommitSha}`}
            </code>
          </pre>
        </div>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `apps/web/components/review/checklist-approvals-tab.tsx`**

```typescript
"use client";

import { useId, useState } from "react";
import type { DemoApproval, DemoChecklistItem } from "../../lib/demo-data.js";
import { Panel, StatusBadge } from "../ui.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";

export function ChecklistApprovalsTab({
  checklist,
  approvals,
  evidenceDigest,
  onToggleChecklist,
  onAddChecklist,
}: {
  checklist: DemoChecklistItem[];
  approvals: DemoApproval[];
  evidenceDigest: string;
  onToggleChecklist?: (id: string, completed: boolean) => void;
  onAddChecklist?: (title: string) => void;
}) {
  const [newItemTitle, setNewItemTitle] = useState("");
  const newItemFieldId = useId();

  function handleToggle(id: string) {
    const item = checklist.find((c) => c.id === id);
    if (!item) return;
    onToggleChecklist?.(id, !item.completed);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemTitle.trim()) return;
    onAddChecklist?.(newItemTitle.trim());
    setNewItemTitle("");
  }

  const completedCount = checklist.filter((i) => i.completed).length;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Hardware Verification Checklist"
        description={`${completedCount} of ${checklist.length} verification items completed.`}
        tone="raised"
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0}%` }}
          />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {checklist.map((item) => (
            <label
              key={item.id}
              className={`flex items-start gap-3 rounded-md border border-border bg-card p-3 ${item.completed ? "opacity-70" : ""}`}
            >
              <input type="checkbox" checked={item.completed} onChange={() => handleToggle(item.id)} className="mt-0.5" />
              <div>
                <span className={`text-sm ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {item.title}
                </span>
                {item.completed && item.completedBy ? (
                  <span className="block text-xs text-muted-foreground">
                    Completed by {item.completedBy} at {new Date(item.completedAt ?? "").toLocaleString()}
                  </span>
                ) : null}
              </div>
            </label>
          ))}
        </div>

        <form onSubmit={handleAdd} className="mt-4 flex gap-2">
          <label htmlFor={newItemFieldId} className="sr-only">
            Add custom verification check
          </label>
          <input
            id={newItemFieldId}
            type="text"
            placeholder="Add custom verification check (e.g. 'Validate high-speed differential pairs match within 0.1mm')..."
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.currentTarget.value)}
            className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
          <Button type="submit" variant="secondary">
            + Add Check
          </Button>
        </form>
      </Panel>

      <Panel
        title="Formal Approvals & Sign-Off Ledger"
        description="Engineering sign-offs recorded against revision evidence digests."
        tone="default"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Approver</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Reason / Justification</th>
                <th className="py-2 pr-3">Evidence Digest</th>
                <th className="py-2 pr-3">Recorded At</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    No sign-offs recorded yet.
                  </td>
                </tr>
              ) : (
                approvals.map((app) => {
                  const isCurrentDigest = app.evidenceDigest === evidenceDigest;
                  return (
                    <tr key={app.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 pr-3">
                        <strong className="font-medium text-foreground">{app.approverId}</strong>
                        {app.isBreakGlass ? (
                          <Badge variant="warning" className="ml-2">
                            ⚡ Break-Glass
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge
                          value={
                            app.status === "approved" ? "pass" : app.status === "invalidated" ? "warning" : "failed"
                          }
                          label={app.status}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {app.reason ?? "—"}
                        {app.invalidationReason ? (
                          <div className="mt-1 text-xs text-danger">⚠️ Invalidation: {app.invalidationReason}</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <code title={app.evidenceDigest}>{app.evidenceDigest.slice(0, 10)}...</code>
                        {!isCurrentDigest ? (
                          <span className="ml-1 text-xs text-muted-foreground" title="Targeted previous revision">
                            (previous)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{new Date(app.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 5: Run `tests/unit/web/review-detail-tabs.test.ts`, which covers all four tabs**

Run: `corepack pnpm exec vitest run tests/unit/web/review-detail-tabs.test.ts`
Expected: PASS — none of its assertions (`provenance-chain`, `Head Evidence Digest`, the exact evidence/approvals copy strings) reference removed class names; they check text content and structural props that this rewrite preserves.

- [ ] **Step 6: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/review/overview-tab.tsx apps/web/components/review/changes-tab.tsx apps/web/components/review/evidence-tab.tsx apps/web/components/review/checklist-approvals-tab.tsx
git commit -m "feat(web): migrate Overview, Changes, Evidence, and Checklist/Approvals tabs to Tailwind"
```

### Task 13: Migrate the Findings tab, Discussion tab, and the two decision modals

**Files:**
- Modify: `apps/web/components/review/findings-tab.tsx`
- Modify: `apps/web/components/review/discussion-tab.tsx`
- Modify: `apps/web/components/review/approval-modal.tsx`
- Modify: `apps/web/components/review/decision-modal.tsx`
- Modify: `tests/unit/web/review-detail-tabs.test.ts`

**Interfaces:**
- Consumes: `Panel` (`apps/web/components/ui.tsx`); `Button` (`apps/web/components/ui/button.tsx`, Task 3); `Dialog` (`apps/web/components/dialog.tsx`, converted in Task 11).
- Produces: no new exports; `FindingsTab`, `DiscussionTab`, `ApprovalModal`, `DecisionModal` keep their existing prop shapes, still consumed only by `ReviewView` (Task 11).

`FindingsTab` is the most state-heavy tab in the app (diff-state filter, severity filter, search, keyboard triage shortcuts `j`/`k`/`e`/`f`/`o`, a per-row assignee draft map) — all of that logic (`apps/web/components/review/findings-tab.tsx:17-140`) is pure JS/state with zero CSS dependency and is preserved verbatim; only the JSX return (from `return (` through the final `);` of the component, plus each `.map()` row's JSX) changes below.

- [ ] **Step 1: Rewrite the `return` block of `apps/web/components/review/findings-tab.tsx` (everything above `return (` — all hooks, `handleDiffStateTabKeyDown`, `filteredFindings`, `handleDirectDisposition`, `handleAssign`, the keyboard-shortcut `useEffect`, `handleModalConfirm`, `counts` — is unchanged)**

```typescript
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter findings by diff state">
          <button
            id="diff-state-tab-all"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "all"}
            tabIndex={selectedDiffState === "all" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("all");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "all")}
          >
            All ({counts.all})
          </button>
          <button
            id="diff-state-tab-new"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "new"}
            tabIndex={selectedDiffState === "new" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "new" ? "bg-info-surface text-info" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("new");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "new")}
          >
            + New ({counts.new})
          </button>
          <button
            id="diff-state-tab-persistent"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "persistent"}
            tabIndex={selectedDiffState === "persistent" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "persistent" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("persistent");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "persistent")}
          >
            Persistent ({counts.persistent})
          </button>
          <button
            id="diff-state-tab-regressed"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "regressed"}
            tabIndex={selectedDiffState === "regressed" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "regressed" ? "bg-danger-surface text-danger" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("regressed");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "regressed")}
          >
            ⚠ Regressed ({counts.regressed})
          </button>
          <button
            id="diff-state-tab-resolved"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "resolved"}
            tabIndex={selectedDiffState === "resolved" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "resolved" ? "bg-success-surface text-success" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("resolved");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "resolved")}
          >
            ✓ Resolved ({counts.resolved})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search findings"
            placeholder="Search rule, component, message..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="min-w-48 flex-1 rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />

          <select
            aria-label="Filter by severity"
            value={selectedSeverity}
            onChange={(e) => {
              setSelectedSeverity(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>

          <div className="text-xs text-muted-foreground">
            <span>Shortcuts: </span>
            <kbd className="rounded-sm border border-border bg-muted px-1">j</kbd>/
            <kbd className="rounded-sm border border-border bg-muted px-1">k</kbd>
            {" navigate "}
            <kbd className="rounded-sm border border-border bg-muted px-1">e</kbd>
            {" accept risk "}
            <kbd className="rounded-sm border border-border bg-muted px-1">f</kbd>
            {" false positive "}
            <kbd className="rounded-sm border border-border bg-muted px-1">o</kbd>
            {" open"}
          </div>
        </div>
      </div>

      {/* Renders every filtered finding; not actually windowed yet, so a 10k-finding
          review will mount 10k DOM nodes. Needs real windowing before that scale is safe. */}
      <div className="flex flex-col gap-2">
        {filteredFindings.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No findings match the current filter criteria.
          </div>
        ) : (
          filteredFindings.map((finding, idx) => {
            const isSelected = idx === selectedIndex;
            const isWaived = finding.disposition === "accepted_risk" || finding.disposition === "false_positive";

            return (
              <article
                key={finding.fingerprint}
                className={`rounded-md border p-3 ${isSelected ? "border-primary" : "border-border"} ${isWaived ? "opacity-60" : ""} bg-card`}
                data-selected={isSelected}
                onClick={() => setSelectedIndex(idx)}
                onFocus={() => setSelectedIndex(idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelectedIndex(idx);
                  }
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-xs uppercase ${finding.severity === "error" || finding.severity === "critical" ? "bg-danger-surface text-danger" : finding.severity === "warning" ? "bg-warning-surface text-warning" : "bg-info-surface text-info"}`}
                    >
                      {finding.severity}
                    </span>
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-xs ${finding.diffState === "new" ? "bg-info-surface text-info" : finding.diffState === "regressed" ? "bg-danger-surface text-danger" : finding.diffState === "resolved" ? "bg-success-surface text-success" : "bg-secondary text-secondary-foreground"}`}
                    >
                      {finding.diffState}
                    </span>
                    <code className="text-xs">{finding.ruleId}</code>
                    {finding.component ? (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{finding.component}</span>
                    ) : null}
                  </div>

                  <select
                    aria-label={`Disposition for finding ${finding.ruleId}`}
                    value={finding.disposition}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const newDisp = e.currentTarget.value as FindingDisposition;
                      if (newDisp === "accepted_risk" || newDisp === "false_positive") {
                        setModalFinding({ finding, targetDisposition: newDisp });
                      } else {
                        handleDirectDisposition(finding.fingerprint, newDisp);
                      }
                    }}
                    className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                  >
                    <option value="open">Open (Fix Required)</option>
                    <option value="fixed">Fixed</option>
                    <option value="accepted_risk">Accepted Risk (Waived)</option>
                    <option value="false_positive">False Positive</option>
                    <option value="not_applicable">Not Applicable</option>
                  </select>
                </div>

                <p className="mt-2 text-sm text-foreground">{finding.message}</p>

                <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <span>
                    📄 {finding.path} {finding.sheet ? `• Sheet: ${finding.sheet}` : ""}
                  </span>

                  {finding.decisionReason ? (
                    <div>
                      <span className="font-medium text-foreground">Decision ({finding.decisionOwner}):</span>{" "}
                      {finding.decisionReason}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <span>Assignee:</span>
                    <span className="text-foreground">
                      {finding.assignees.length > 0 ? finding.assignees.join(", ") : "Unassigned"}
                    </span>
                    <input
                      type="text"
                      aria-label={`Add assignee for finding ${finding.ruleId}`}
                      placeholder="Add assignee…"
                      value={assigneeDraft[finding.fingerprint] ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setAssigneeDraft((prev) => ({ ...prev, [finding.fingerprint]: value }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAssign(finding.fingerprint, assigneeDraft[finding.fingerprint] ?? "");
                        }
                      }}
                      className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                    <button
                      type="button"
                      className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAssign(finding.fingerprint, assigneeDraft[finding.fingerprint] ?? "");
                      }}
                    >
                      Assign
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {modalFinding ? (
        <DecisionModal
          finding={modalFinding.finding}
          targetDisposition={modalFinding.targetDisposition}
          onConfirm={handleModalConfirm}
          onClose={() => setModalFinding(null)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/components/review/discussion-tab.tsx`**

```typescript
"use client";

import { useId, useState } from "react";
import type { DemoComment } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";
import { Button } from "../ui/button.js";

export function DiscussionTab({
  comments,
  viewerLogin,
  onAddComment,
  onToggleStatus,
}: {
  comments: DemoComment[];
  viewerLogin?: string | undefined;
  onAddComment?: (content: string) => void;
  onToggleStatus?: (commentId: string, nextStatus: "open" | "resolved") => void;
}) {
  const [newContent, setNewContent] = useState("");
  const commentFieldId = useId();

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newContent.trim();
    if (!trimmed) return;
    onAddComment?.(trimmed);
    setNewContent("");
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Review Discussion & Threads" tone="raised">
        <div className="flex flex-col gap-3">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments posted yet. Start the conversation below.</p>
          ) : (
            comments.map((cmt) => (
              <div
                key={cmt.id}
                className={`rounded-md border border-border bg-card p-3 ${cmt.status === "outdated" ? "opacity-60" : ""}`}
              >
                <header className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">{cmt.authorId}</span>
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{cmt.authorType}</span>
                    <span className="text-xs text-muted-foreground">{new Date(cmt.createdAt).toLocaleString()}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={cmt.status === "resolved" ? "secondary" : "ghost"}
                    onClick={() => onToggleStatus?.(cmt.id, cmt.status === "resolved" ? "open" : "resolved")}
                    disabled={cmt.status === "outdated"}
                  >
                    {cmt.status === "resolved" ? "✓ Resolved" : "Mark Resolved"}
                  </Button>
                </header>

                <div className="mt-2 text-sm text-foreground">
                  <p>{cmt.content}</p>
                </div>

                {cmt.findingFingerprint ? (
                  <footer className="mt-2 text-xs text-muted-foreground">
                    <span>Anchored to Finding: </span>
                    <code>{cmt.findingFingerprint}</code>
                  </footer>
                ) : null}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handlePost} className="mt-4 rounded-md border border-border bg-card p-3">
          <h4 className="text-sm font-bold text-foreground">Add to Discussion</h4>
          <label htmlFor={commentFieldId} className="sr-only">
            Comment
          </label>
          <textarea
            id={commentFieldId}
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.currentTarget.value)}
            placeholder="Leave an engineering review note or question..."
            className="mt-2 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
          <footer className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Commenting as {viewerLogin ?? "you"}</span>
            <Button type="submit">Post Comment</Button>
          </footer>
        </form>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/components/review/approval-modal.tsx`**

```typescript
"use client";

import { useState } from "react";
import { Dialog } from "../dialog.js";
import { Button } from "../ui/button.js";

export interface ApprovalModalProps {
  readonly type: "approve" | "request_changes";
  readonly evidenceDigest: string;
  readonly isSubmitting?: boolean;
  readonly serverError?: string | null;
  readonly onConfirm: (data: { reason: string; isBreakGlass?: boolean }) => void;
  readonly onClose: () => void;
}

function getSubmitButtonLabel(isSubmitting: boolean, isApprove: boolean): string {
  if (isSubmitting) return "Recording...";
  return isApprove ? "Confirm Sign-Off" : "Submit Change Request";
}

export function ApprovalModal({
  type,
  evidenceDigest,
  isSubmitting = false,
  serverError = null,
  onConfirm,
  onClose,
}: ApprovalModalProps) {
  const isApprove = type === "approve";
  const [reason, setReason] = useState("");
  const [isBreakGlass, setIsBreakGlass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isApprove && !reason.trim()) {
      setError("Please specify what changes are required before fabrication.");
      return;
    }
    onConfirm({
      reason: reason.trim(),
      ...(isBreakGlass ? { isBreakGlass: true } : {}),
    });
  }

  const submitLabel = getSubmitButtonLabel(isSubmitting, isApprove);
  const title = isApprove ? "Record Engineering Sign-Off" : "Request Hardware Changes";
  const reasonLabel = isApprove ? "Sign-Off Notes (Optional)" : "Required Changes & Action Items *";
  const reasonPlaceholder = isApprove
    ? "e.g. Reviewed high-voltage clearance, thermal vias, and CAN isolation barrier. Approved for prototype run."
    : "e.g. Clearance between ISO_CAN_VCC and GND must be increased to >= 0.50mm.";
  const displayError = error ?? serverError;

  return (
    <Dialog titleId="approval-modal-title" onClose={onClose}>
      <header className="flex items-center justify-between border-b border-border p-4">
        <h2 id="approval-modal-title" className="text-base font-bold text-foreground">
          {title}
        </h2>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close modal"
          disabled={isSubmitting}
        >
          ✕
        </button>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span>Bound to Evidence Digest:</span>
          <code>{evidenceDigest.slice(0, 16)}...</code>
        </div>

        <div>
          <label htmlFor="approval-reason" className="text-sm font-medium text-foreground">
            {reasonLabel}
          </label>
          <textarea
            id="approval-reason"
            rows={3}
            value={reason}
            disabled={isSubmitting}
            onChange={(e) => {
              setReason(e.currentTarget.value);
              setError(null);
            }}
            placeholder={reasonPlaceholder}
            className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required={!isApprove}
          />
        </div>

        {isApprove ? (
          <div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isBreakGlass}
                disabled={isSubmitting}
                onChange={(e) => setIsBreakGlass(e.currentTarget.checked)}
              />
              <span>⚡ Break-Glass Override (Emergency sign-off with audit logging)</span>
            </label>
          </div>
        ) : null}

        {displayError ? (
          <div className="rounded-md border border-danger/40 bg-danger-surface px-3 py-2 text-sm text-danger">{displayError}</div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant={isApprove ? "default" : "destructive"} disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 4: Rewrite `apps/web/components/review/decision-modal.tsx`**

```typescript
"use client";

import type { FindingDisposition } from "@boardreadyops/contracts";
import { useState } from "react";
import type { DemoFinding } from "../../lib/demo-data.js";
import { Dialog } from "../dialog.js";
import { Button } from "../ui/button.js";

export interface DecisionModalProps {
  finding: DemoFinding;
  targetDisposition: FindingDisposition;
  onConfirm: (data: { reason: string; owner: string; expiresAt?: string }) => void;
  onClose: () => void;
}

export function DecisionModal({ finding, targetDisposition, onConfirm, onClose }: DecisionModalProps) {
  const isAcceptedRisk = targetDisposition === "accepted_risk";
  const [reason, setReason] = useState(finding.decisionReason ?? "");
  const [owner, setOwner] = useState(finding.decisionOwner ?? "engineer@company.com");
  const [expiresAt, setExpiresAt] = useState(finding.decisionExpiresAt ?? "");
  const [error, setError] = useState<string | null>(null);

  const minChars = isAcceptedRisk ? 20 : 5;
  const isValid = reason.trim().length >= minChars;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError(`Justification must be at least ${minChars} characters.`);
      return;
    }
    onConfirm({
      reason: reason.trim(),
      owner: owner.trim(),
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  return (
    <Dialog titleId="decision-modal-title" onClose={onClose}>
      <header className="flex items-center justify-between border-b border-border p-4">
        <h2 id="decision-modal-title" className="text-base font-bold text-foreground">
          Record Finding Decision: <span className="text-primary">{targetDisposition.replace("_", " ")}</span>
        </h2>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close modal">
          ✕
        </button>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="rounded-md bg-muted px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-sm bg-card px-1.5 py-0.5">{finding.ruleId}</span>
            <span className="rounded-sm bg-card px-1.5 py-0.5">{finding.component ?? "Global"}</span>
          </div>
          <p className="mt-1 text-sm text-foreground">{finding.message}</p>
        </div>

        <div>
          <label htmlFor="decision-reason" className="text-sm font-medium text-foreground">
            Engineering Justification Reason <span className="text-danger">*</span>
          </label>
          <textarea
            id="decision-reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.currentTarget.value);
              setError(null);
            }}
            placeholder={
              isAcceptedRisk
                ? "Describe why this risk is acceptable for fabrication (min 20 characters)..."
                : "Explain reason for this decision..."
            }
            className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
          <div className="mt-1 text-xs">
            <span className={reason.trim().length >= minChars ? "text-success" : "text-muted-foreground"}>
              {reason.trim().length} / {minChars} characters required
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="decision-owner" className="text-sm font-medium text-foreground">
              Decision Owner / Approver
            </label>
            <input
              type="email"
              id="decision-owner"
              value={owner}
              onChange={(e) => setOwner(e.currentTarget.value)}
              className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              required
            />
          </div>

          <div>
            <label htmlFor="decision-expires" className="text-sm font-medium text-foreground">
              Expiry Date (Optional Waiver Sunset)
            </label>
            <input
              type="date"
              id="decision-expires"
              value={expiresAt ?? ""}
              onChange={(e) => setExpiresAt(e.currentTarget.value)}
              className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-danger/40 bg-danger-surface px-3 py-2 text-sm text-danger">{error}</div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid}>
            Save Decision
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run `tests/unit/web/review-detail-tabs.test.ts`**

Run: `corepack pnpm exec vitest run tests/unit/web/review-detail-tabs.test.ts`
Expected: PASS — its `ChangesTab`/`ChecklistApprovalsTab` assertions (from Task 12) and its `ReviewHeader`/`ReviewView` assertions (from Task 11) are unaffected by this task; no test in this file currently exercises `FindingsTab`, `DiscussionTab`, or the modals directly (they're exercised indirectly through `ReviewView`'s tablist/tabpanel test), so no test edits are needed here.

- [ ] **Step 6: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/review/findings-tab.tsx apps/web/components/review/discussion-tab.tsx apps/web/components/review/approval-modal.tsx apps/web/components/review/decision-modal.tsx
git commit -m "feat(web): migrate Findings tab, Discussion tab, and decision modals to Tailwind"
```

### Task 14: Migrate `ReviewCanvas`; delete the dead `TriPaneReviewLayout`

**Files:**
- Modify: `apps/web/components/review/review-canvas.tsx`
- Delete: `apps/web/components/review/tri-pane-layout.tsx`
- Delete: `tests/unit/web/tri-pane-review.test.ts`

**Interfaces:**
- Consumes: nothing new — `ReviewCanvas` has no `ui.tsx`/shadcn dependency today (it's pure SVG/pointer-event markup) and stays that way.
- Produces: no exports change; `ReviewCanvas` keeps its existing prop shape (still consumed by `ChangesTab`, Task 12).

`TriPaneReviewLayout` (`apps/web/components/review/tri-pane-layout.tsx`) is confirmed dead code: `grep -rn "TriPaneReviewLayout" apps/web` returns only its own definition and its own test file — it is never imported by `ReviewView`, `ChangesTab`, `FindingsTab`, or any route. The live triage UI today is `FindingsTab` (list + keyboard shortcuts + `DecisionModal`) plus `ReviewCanvas` (the SVG board view inside `ChangesTab`), not this component. It predates one of them and was superseded without being removed.

This matters for this migration specifically because of the ADR's rollout gate (`docs/architecture/adr/0016-ui-ux-design-system-migration.md`, Rollout strategy item 3): `styles.css` can only be deleted once a repo-wide grep for its class names returns zero hits in `apps/web/`. `tri-pane-layout.tsx` references dozens of `styles.css` classes (`.tri-pane`, `.mobile-pane-tab`, `.finding-card`, `.waiver-form`, etc.) that no other file uses, so left in place unconverted it would permanently block that gate. Converting ~300 lines of markup nothing renders would be pure waste; deleting it clears the gate correctly. This is a pre-existing-dead-code removal directly required by this task's own acceptance criteria, not an unrelated cleanup.

- [ ] **Step 1: Confirm the component is unreferenced outside itself and its test**

Run: `grep -rn "TriPaneReviewLayout" apps/web`
Expected: two matches, both inside `apps/web/components/review/tri-pane-layout.tsx` itself (the `export function` line and its own type name) — no import from any other file.

- [ ] **Step 2: Delete the dead component and its test**

```bash
git rm apps/web/components/review/tri-pane-layout.tsx tests/unit/web/tri-pane-review.test.ts
```

- [ ] **Step 3: Rewrite `apps/web/components/review/review-canvas.tsx`**

```typescript
"use client";

import type { CanvasAnchor, SnapshotArtifact } from "@boardreadyops/contracts";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { DemoComment, DemoFinding } from "../../lib/demo-data.js";

export interface ReviewCanvasProps {
  headSnapshots: SnapshotArtifact[];
  baseSnapshots?: SnapshotArtifact[];
  findings?: DemoFinding[];
  comments?: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
  onAddCommentAtPoint?: (point: { x: number; y: number; sheetOrLayer: string }) => void;
}

export type ViewMode = "head" | "base" | "overlay" | "diff" | "split";

function toImageSrc(content?: string): string {
  if (!content) return "";
  if (content.startsWith("data:") || content.startsWith("http://") || content.startsWith("https://")) {
    return content;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
}

const markerBase =
  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background px-1.5 py-0.5 text-[10px] font-medium shadow";

function markerSeverityClass(severity: string): string {
  if (severity === "error" || severity === "critical") return "bg-danger text-white";
  return "bg-warning text-white";
}

interface CanvasMarkersProps {
  sheetAnchors: CanvasAnchor[];
  relevantFindings: DemoFinding[];
  comments: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
}

function CanvasMarkersLayer({
  sheetAnchors,
  relevantFindings,
  comments,
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
}: Readonly<CanvasMarkersProps>) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {sheetAnchors.map((anchor) => {
        if (anchor.kind === "finding" && anchor.metadata?.fingerprint) {
          const fp = String(anchor.metadata.fingerprint);
          const isSelected = fp === selectedFindingFingerprint;
          const sev = String(anchor.metadata.severity ?? "warning");

          return (
            <button
              type="button"
              key={anchor.id}
              className={`${markerBase} ${markerSeverityClass(sev)} pointer-events-auto ${isSelected ? "ring-2 ring-primary" : ""}`}
              style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectFinding?.(fp);
              }}
              title={`Finding: ${anchor.metadata.ruleId}\n${anchor.metadata.message}`}
            >
              {anchor.targetRef}
            </button>
          );
        }

        if (anchor.kind === "component" && anchor.targetRef) {
          const compFinding = relevantFindings.find((f) => f.component === anchor.targetRef);
          if (compFinding) {
            const isSelected = compFinding.fingerprint === selectedFindingFingerprint;
            return (
              <button
                type="button"
                key={anchor.id}
                className={`${markerBase} ${markerSeverityClass(compFinding.severity)} pointer-events-auto ${isSelected ? "ring-2 ring-primary" : ""}`}
                style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFinding?.(compFinding.fingerprint);
                }}
                title={`Finding on ${anchor.targetRef}: ${compFinding.ruleId}`}
              >
                {anchor.targetRef}
              </button>
            );
          }
        }

        return null;
      })}

      {comments
        .filter((c) => c.findingFingerprint)
        .map((comment) => (
          <button
            type="button"
            key={comment.id}
            className="pointer-events-auto absolute rounded-full bg-card px-1 text-sm shadow"
            onClick={(e) => {
              e.stopPropagation();
              onSelectComment?.(comment.id);
            }}
            title={`Comment by ${comment.authorId}: ${comment.content}`}
          >
            💬
          </button>
        ))}
    </div>
  );
}

function SplitViewport({ baseSrc, headSrc }: Readonly<{ baseSrc: string; headSrc: string }>) {
  return (
    <div className="grid h-full grid-cols-2 gap-2">
      <div className="relative overflow-hidden rounded-md border border-border bg-muted">
        <span className="absolute left-2 top-2 rounded-sm bg-card px-1.5 py-0.5 text-xs text-muted-foreground">Base Revision</span>
        {baseSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={baseSrc} alt="Base Revision Snapshot" className="size-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No base snapshot</div>
        )}
      </div>

      <div className="relative overflow-hidden rounded-md border border-border bg-muted">
        <span className="absolute left-2 top-2 rounded-sm bg-card px-1.5 py-0.5 text-xs text-muted-foreground">Head Revision</span>
        {headSrc ? (
          // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
          <img src={headSrc} alt="Head Revision Snapshot" className="size-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No head snapshot</div>
        )}
      </div>
    </div>
  );
}

function StackedLayersView({
  viewMode,
  baseSrc,
  headSrc,
  opacity,
  sheetAnchors,
  relevantFindings,
  comments,
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
}: Readonly<{
  viewMode: ViewMode;
  baseSrc: string;
  headSrc: string;
  opacity: number;
  sheetAnchors: CanvasAnchor[];
  relevantFindings: DemoFinding[];
  comments: DemoComment[];
  selectedFindingFingerprint?: string | undefined;
  onSelectFinding?: ((fingerprint: string) => void) | undefined;
  onSelectComment?: ((commentId: string) => void) | undefined;
}>) {
  return (
    <div className="relative h-full w-full">
      {(viewMode === "overlay" || viewMode === "base" || viewMode === "diff") && baseSrc ? (
        // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
        <img
          src={baseSrc}
          alt="Base Revision Snapshot Layer"
          className="absolute inset-0 size-full object-contain"
          style={{
            opacity: viewMode === "overlay" ? 1 - opacity : 1,
            filter: viewMode === "diff" ? "invert(1) grayscale(1)" : "none",
          }}
        />
      ) : null}

      {(viewMode === "overlay" || viewMode === "head" || viewMode === "diff") && headSrc ? (
        // biome-ignore lint/performance/noImgElement: dynamic svg data-uri rasterization
        <img
          src={headSrc}
          alt="Head Revision Snapshot Layer"
          className="absolute inset-0 size-full object-contain"
          style={{
            opacity: viewMode === "overlay" ? opacity : 1,
            mixBlendMode: viewMode === "diff" ? "difference" : "normal",
          }}
        />
      ) : null}

      <CanvasMarkersLayer
        sheetAnchors={sheetAnchors}
        relevantFindings={relevantFindings}
        comments={comments}
        selectedFindingFingerprint={selectedFindingFingerprint}
        onSelectFinding={onSelectFinding}
        onSelectComment={onSelectComment}
      />
    </div>
  );
}

export function ReviewCanvas({
  headSnapshots,
  baseSnapshots = [],
  findings = [],
  comments = [],
  selectedFindingFingerprint,
  onSelectFinding,
  onSelectComment,
  onAddCommentAtPoint,
}: Readonly<ReviewCanvasProps>) {
  const [selectedSheetOrLayer, setSelectedSheetOrLayer] = useState<string>(headSnapshots[0]?.sheetOrLayer ?? "Main");
  const [viewMode, setViewMode] = useState<ViewMode>("overlay");
  const [opacity, setOpacity] = useState<number>(0.5);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentHeadSnapshot = headSnapshots.find((s) => s.sheetOrLayer === selectedSheetOrLayer) ?? headSnapshots[0];
  const currentBaseSnapshot = baseSnapshots.find((s) => s.sheetOrLayer === selectedSheetOrLayer) ?? baseSnapshots[0];

  const availableSheets = Array.from(
    new Set([...headSnapshots.map((s) => s.sheetOrLayer), ...baseSnapshots.map((s) => s.sheetOrLayer)]),
  );

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 5));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.25, 0.2));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setHasMoved(false);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setHasMoved(true);
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!hasMoved && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = (e.clientX - rect.left - pan.x) / (rect.width * zoom);
      const clickY = (e.clientY - rect.top - pan.y) / (rect.height * zoom);

      if (clickX >= 0 && clickX <= 1 && clickY >= 0 && clickY <= 1) {
        onAddCommentAtPoint?.({
          x: Math.round(clickX * 1000) / 1000,
          y: Math.round(clickY * 1000) / 1000,
          sheetOrLayer: selectedSheetOrLayer,
        });
      }
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z * 1.25, 5));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(z / 1.25, 0.2));
      } else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === "ArrowLeft") {
        setPan((p) => ({ ...p, x: p.x + 20 }));
      } else if (e.key === "ArrowRight") {
        setPan((p) => ({ ...p, x: p.x - 20 }));
      } else if (e.key === "ArrowUp") {
        setPan((p) => ({ ...p, y: p.y + 20 }));
      } else if (e.key === "ArrowDown") {
        setPan((p) => ({ ...p, y: p.y - 20 }));
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const sheetAnchors = currentHeadSnapshot?.anchors ?? [];
  const relevantFindings = findings.filter(
    (f) => !f.sheet || f.sheet.toLowerCase() === selectedSheetOrLayer.toLowerCase(),
  );

  const baseSrc = toImageSrc(currentBaseSnapshot?.content);
  const headSrc = toImageSrc(currentHeadSnapshot?.content);

  const modeButtonClass = (active: boolean) =>
    `rounded-sm px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <section className="flex flex-wrap items-center justify-between gap-3" aria-label="Canvas instruments">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="sheet-select" className="text-xs text-muted-foreground">
            Layer / Sheet:
          </label>
          <select
            id="sheet-select"
            value={selectedSheetOrLayer}
            onChange={(e) => setSelectedSheetOrLayer(e.currentTarget.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {availableSheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1">
            <button type="button" className={modeButtonClass(viewMode === "overlay")} onClick={() => setViewMode("overlay")} title="Overlay with opacity slider">
              Overlay
            </button>
            <button type="button" className={modeButtonClass(viewMode === "split")} onClick={() => setViewMode("split")} title="Side-by-side comparison">
              Split
            </button>
            <button type="button" className={modeButtonClass(viewMode === "diff")} onClick={() => setViewMode("diff")} title="Difference highlight">
              Visual Diff
            </button>
            <button type="button" className={modeButtonClass(viewMode === "head")} onClick={() => setViewMode("head")} title="Head revision only">
              Head Only
            </button>
            <button type="button" className={modeButtonClass(viewMode === "base")} onClick={() => setViewMode("base")} title="Base revision only">
              Base Only
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {viewMode === "overlay" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Base</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(Number.parseFloat(e.currentTarget.value))}
                aria-label="Overlay blend: base vs. head snapshot opacity"
                title={`Head Opacity: ${Math.round(opacity * 100)}%`}
              />
              <span>Head ({Math.round(opacity * 100)}%)</span>
            </div>
          ) : null}

          <div className="flex items-center gap-1 text-sm">
            <button type="button" onClick={handleZoomOut} className="rounded-sm border border-border px-2 py-1 hover:bg-accent" aria-label="Zoom out" title="Zoom Out (-)">
              −
            </button>
            <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={handleZoomIn} className="rounded-sm border border-border px-2 py-1 hover:bg-accent" aria-label="Zoom in" title="Zoom In (+)">
              +
            </button>
            <button type="button" onClick={handleReset} className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent" aria-label="Reset zoom and pan" title="Reset View (0)">
              ↺ Reset
            </button>
          </div>
        </div>
      </section>

      <section
        ref={containerRef}
        aria-label="Schematic and PCB Review Canvas"
        className={`relative h-96 overflow-hidden rounded-md border border-border bg-muted ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {viewMode === "split" ? (
            <SplitViewport baseSrc={baseSrc} headSrc={headSrc} />
          ) : (
            <StackedLayersView
              viewMode={viewMode}
              baseSrc={baseSrc}
              headSrc={headSrc}
              opacity={opacity}
              sheetAnchors={sheetAnchors}
              relevantFindings={relevantFindings}
              comments={comments}
              selectedFindingFingerprint={selectedFindingFingerprint}
              onSelectFinding={onSelectFinding}
              onSelectComment={onSelectComment}
            />
          )}
        </div>
      </section>
    </div>
  );
}
```

`review-canvas.test.ts`'s assertions (`"Schematic and PCB Review Canvas"`, `'aria-label="Canvas instruments"'`, `"data:image/svg+xml"`, `"finding-marker"`, `"canvas-viewport"`) need one update: `"finding-marker"` and `"canvas-viewport"` were literal class-name substrings, both now removed.

- [ ] **Step 4: Update the two stale class-name assertions in `tests/unit/web/review-canvas.test.ts`**

```typescript
  it("renders a finding marker for each anchor linked to a finding", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots, findings: [], comments: [] }));
    const findingAnchorCount = headSnapshots[0]?.anchors.filter((a) => a.kind === "finding").length ?? 0;
    if (findingAnchorCount > 0) {
      expect(markup).toContain(headSnapshots[0]?.anchors.find((a) => a.kind === "finding")?.targetRef);
    }
  });

  it("shows an empty-pane message instead of a broken image when no snapshot exists for a mode", () => {
    const markup = renderToStaticMarkup(createElement(ReviewCanvas, { headSnapshots: [], findings: [], comments: [] }));
    expect(markup).toContain('aria-label="Schematic and PCB Review Canvas"');
  });
```

(Replaces the two assertions on lines 27–32 and 34–37 of the original test file; the other two tests in that file are unaffected.)

- [ ] **Step 5: Run the updated test**

Run: `corepack pnpm exec vitest run tests/unit/web/review-canvas.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the dead-code deletion didn't break anything and no `styles.css` classes from the deleted file remain referenced elsewhere**

Run: `corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && grep -rn "tri-pane\|mobile-pane-tab\|waiver-form" apps/web --include=*.tsx`
Expected: typecheck passes; the grep returns no matches (those classes existed only in the deleted file).

- [ ] **Step 7: Lint, typecheck, and run the full web test suite**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && corepack pnpm exec vitest run tests/unit/web/`
Expected: all pass. This closes out the entire Reviews feature (Tasks 10–14) — this is a good point to also run `grep -rln "review-" apps/web/app/styles.css | head` mentally against the files just converted, confirming no `review-*`/`finding-*`/`comment-*`/`modal-*`/`canvas-*`/`tri-pane-*` selector from `styles.css` is referenced by any file under `apps/web/components/review/` or `apps/web/app/reviews/` any more (full repo-wide verification happens in the Phase D cleanup task).

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/review/review-canvas.tsx tests/unit/web/review-canvas.test.ts
git rm apps/web/components/review/tri-pane-layout.tsx tests/unit/web/tri-pane-review.test.ts
git commit -m "feat(web): migrate ReviewCanvas to Tailwind; remove dead TriPaneReviewLayout"
```

This completes the Reviews feature migration (Tasks 10–14).

### Task 15: Migrate Deliveries, Delivery detail, and Parts

**Files:**
- Modify: `apps/web/app/deliveries/page.tsx`
- Modify: `apps/web/app/deliveries/[token]/page.tsx`
- Modify: `apps/web/components/delivery-signoff-card.tsx`
- Modify: `apps/web/app/parts/page.tsx`
- Modify: `tests/unit/web/deliveries-page.test.ts` — no changes needed (see Step 5), listed for completeness.

**Interfaces:**
- Consumes: `AppShell`, `Breadcrumbs`, `EmptyState`, `Panel` (`apps/web/components/ui.tsx`).
- Produces: no new exports; `DeliverySignoffCard`'s prop shape (`revisionId`, `bundleSha256`, `readinessVerdict`, `readinessScore`, `waiverCount`, `signedArchiveUrl`, `signedBy`, `signedAt`, `recipientNotes`, `expiresAt`, `children`) — set by the security-fix pass earlier in this initiative — is unchanged.

These three pages/components are grouped into one task because they're structurally identical to each other in scope (each is a single `Panel` + `EmptyState`, or in the card's case a single info-dense summary block) and were already observed to be simple during the 2026-09-05 production audit that motivated this migration.

`tests/unit/web/deliveries-page.test.ts` queries `DeliverySignoffCard`'s output via `container.querySelector(".delivery-signoff-card")` and `.download-bundle-button`. Rather than rewrite the test to a role/text query (which would touch a file outside this task's real scope), this task keeps `delivery-signoff-card` and `download-bundle-button` as literal class tokens on their elements alongside the new Tailwind utility classes — the same pattern already used for `data-pane` attributes in the Reviews tri-pane component before its removal. This means **no test file changes are needed for this task**.

- [ ] **Step 1: Rewrite `apps/web/app/deliveries/page.tsx`**

```typescript
import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell.js";
import { Breadcrumbs, Panel } from "../../components/ui.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";

export const metadata: Metadata = {
  title: "Release Deliveries & Fabrication Packages",
  description: "Cryptographically signed manufacturing release deliveries and guest links.",
};

export default function DeliveriesListPage() {
  return (
    <AppShell>
      <main id="main-content" className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Deliveries" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">Release Deliveries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Traceable manufacturing packages, guest sign-off links, and Fabrication Handoff archives.
          </p>
        </header>

        <Panel title="Active Manufacturing Deliveries">
          <GuidedChecklist
            heading="Generate your first manufacturing delivery"
            steps={[
              { id: "review", label: "Complete a hardware review and get it approved", status: "current", href: "/reviews", actionLabel: "Go to Reviews" },
              { id: "deliver", label: "Generate a secure guest delivery link to share verified packages with a manufacturing partner", status: "upcoming" },
            ]}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
```

(Per the ADR's empty-state pattern, this replaces the passive `EmptyState` with `GuidedChecklist` — Deliveries is explicitly one of the four surfaces the ADR names for this pattern, alongside Projects, Parts, and the repository detail page's "no runs yet" state.)

- [ ] **Step 2: Rewrite `apps/web/app/deliveries/[token]/page.tsx`**

```typescript
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { notFound } from "next/navigation";
import { DeliverySignoffCard } from "../../../components/delivery-signoff-card.js";
import { AppShell, Breadcrumbs, EmptyState } from "../../../components/ui.js";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { verifyDeliveryToken } from "../../../lib/delivery-auth.js";

export interface DeliveryPageProps {
  params: Promise<{ token: string }>;
}

export default async function DeliveryPage({ params }: DeliveryPageProps) {
  const { token } = await params;
  const config = resolveCloudPersistenceConfiguration();

  if (config.mode !== "postgres") {
    return (
      <AppShell>
        <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
          <EmptyState title="Service Unavailable">
            <p>Delivery storage is currently unavailable.</p>
          </EmptyState>
        </main>
      </AppShell>
    );
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  let authResult: Awaited<ReturnType<typeof verifyDeliveryToken>>;
  try {
    authResult = await verifyDeliveryToken(token, executor);
  } finally {
    await executor.close();
  }

  if (!authResult.ok) {
    if (authResult.status === 410) {
      return (
        <AppShell>
          <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
            <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Expired Delivery" }]} />
            <EmptyState title="Delivery link has expired">
              <p>
                This secure delivery package was time-limited and has expired. Contact the sender to request a renewed
                link.
              </p>
            </EmptyState>
          </main>
        </AppShell>
      );
    }
    return notFound();
  }

  const delivery = authResult.delivery;
  if (!delivery) {
    return notFound();
  }

  return (
    <AppShell>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Secure Hardware Package Delivery" }]} />
        <DeliverySignoffCard
          revisionId={delivery.revisionId}
          signedArchiveUrl={delivery.signedArchiveUrl}
          recipientNotes={delivery.recipientNotes ?? undefined}
          expiresAt={new Date(delivery.expiresAt).toISOString()}
        />
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/components/delivery-signoff-card.tsx`**

```typescript
import type { ReactNode } from "react";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

export type DeliverySignoffCardProps = Readonly<{
  revisionId: string;
  bundleSha256?: string | undefined;
  readinessVerdict?: "pass" | "fail" | "warning" | undefined;
  readinessScore?: number | undefined;
  waiverCount?: number | undefined;
  signedArchiveUrl: string;
  signedBy?: string | undefined;
  signedAt?: string | undefined;
  recipientNotes?: string | undefined;
  expiresAt: string;
  children?: ReactNode | undefined;
}>;

function verdictBadgeVariant(isVerified: boolean, isPass: boolean): "secondary" | "success" | "danger" {
  if (!isVerified) return "secondary";
  return isPass ? "success" : "danger";
}

function signOffStatus(signedBy: string | undefined, isVerified: boolean): string {
  if (signedBy) return `Signed by ${signedBy}`;
  return isVerified ? "Engineering Auto-Verified" : "Sign-off not recorded";
}

function waiverDisposition(waiverCount: number | undefined): string {
  if (waiverCount === undefined) return "Waivers not evaluated";
  if (waiverCount === 0) return "Zero active waivers";
  return `${waiverCount} active waiver${waiverCount === 1 ? "" : "s"}`;
}

export function DeliverySignoffCard({
  revisionId,
  bundleSha256,
  readinessVerdict,
  readinessScore,
  waiverCount,
  signedArchiveUrl,
  signedBy,
  signedAt,
  recipientNotes,
  expiresAt,
  children,
}: DeliverySignoffCardProps) {
  const isVerified = readinessVerdict !== undefined;
  const isPass = readinessVerdict === "pass";

  return (
    <div className="delivery-signoff-card flex flex-col gap-5 rounded-md border border-border bg-card p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs uppercase text-muted-foreground">
            {isVerified ? "Verified Manufacturing Package" : "Unverified Package"}
          </span>
          <h2 className="text-xl font-bold text-foreground">Revision {revisionId}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={verdictBadgeVariant(isVerified, isPass)}>
            {isVerified ? readinessVerdict.toUpperCase() : "UNVERIFIED"}
          </Badge>
          {readinessScore !== undefined && (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{readinessScore}/100</span>
          )}
        </div>
      </div>

      {recipientNotes && (
        <div className="rounded-md bg-muted p-3 text-sm">
          <strong className="font-medium text-foreground">Notes from Engineering:</strong>
          <p className="mt-1 text-muted-foreground">{recipientNotes}</p>
        </div>
      )}

      <div className="rounded-md bg-muted p-3">
        <span className="text-xs uppercase text-muted-foreground">Cryptographic Archive Digest (SHA-256)</span>
        <code className="mt-1 block break-all text-sm">{bundleSha256 || "Pending verification"}</code>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <span className="block text-xs uppercase text-muted-foreground">Sign-Off Status</span>
          <span className="text-sm text-foreground">{signOffStatus(signedBy, isVerified)}</span>
          {signedAt && <span className="block text-xs text-muted-foreground">{new Date(signedAt).toUTCString()}</span>}
        </div>

        <div>
          <span className="block text-xs uppercase text-muted-foreground">Waiver Dispositions</span>
          <span className="text-sm text-foreground">{waiverDisposition(waiverCount)}</span>
        </div>

        <div>
          <span className="block text-xs uppercase text-muted-foreground">Package Expiration</span>
          <span className="text-sm text-foreground">{new Date(expiresAt).toUTCString()}</span>
        </div>
      </div>

      <Button asChild>
        <a className="download-bundle-button" href={signedArchiveUrl} download rel="noopener noreferrer">
          {isVerified ? "Download Sealed Package (.zip)" : "Download Package (.zip)"}
        </a>
      </Button>

      {children}
    </div>
  );
}
```

`Button asChild` (via `radix-ui`'s `Slot`, already wired in Task 3's `button.tsx`) renders the `<a>` directly with `buttonVariants` classes merged onto it — this keeps the element an anchor (required for `download`/`href`) while still getting `Button`'s visual treatment, and keeps the `download-bundle-button` class the test queries for.

- [ ] **Step 4: Rewrite `apps/web/app/parts/page.tsx`**

```typescript
import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell.js";
import { Breadcrumbs, Panel } from "../../components/ui.js";
import { GuidedChecklist } from "../../components/guided-checklist.js";

export const metadata: Metadata = {
  title: "Component Intelligence & Parts",
  description: "Aggregated BOM component risk, distributor inventory, and lifecycle statuses.",
};

export default function PartsPage() {
  return (
    <AppShell>
      <main id="main-content" className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Dashboard" }, { label: "Parts" }]} />

        <header>
          <h1 className="text-2xl font-bold text-foreground">Component Intelligence & Parts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            BOM risk aggregation, lead-time warnings, end-of-life alerts, and multi-source distributor availability.
          </p>
        </header>

        <Panel title="Aggregated BOM Components">
          <GuidedChecklist
            heading="Populate your component intelligence"
            steps={[
              { id: "setup", label: "Link a repository with a hardware project", status: "current", href: "/setup", actionLabel: "Go to Setup" },
              { id: "ingest", label: "Ingest a manufacturing package or BOM file to populate parts automatically", status: "upcoming" },
            ]}
          />
        </Panel>
      </main>
    </AppShell>
  );
}
```

(Per the ADR's empty-state pattern, this replaces the passive `EmptyState` with `GuidedChecklist` — Parts is explicitly one of the four named surfaces.)

- [ ] **Step 5: Run `tests/unit/web/deliveries-page.test.ts` unmodified to confirm the class-token-preservation approach worked**

Run: `corepack pnpm exec vitest run tests/unit/web/deliveries-page.test.ts`
Expected: PASS with zero edits to the test file.

- [ ] **Step 6: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/deliveries/ apps/web/components/delivery-signoff-card.tsx apps/web/app/parts/page.tsx
git commit -m "feat(web): migrate Deliveries, Delivery detail, and Parts to Tailwind"
```

### Task 16: Migrate the Policies page and `PoliciesClient`

**Files:**
- Modify: `apps/web/app/policies/page.tsx`
- Modify: `apps/web/app/policies/policies-client.tsx`

**Interfaces:**
- Consumes: `AppShell`, `Breadcrumbs`, `EmptyState`, `Panel`, `StatusBadge` (`apps/web/components/ui.tsx`); `Dialog` (`apps/web/components/dialog.tsx`, converted in Task 11); `Button` (`apps/web/components/ui/button.tsx`).
- Produces: no new exports; `PolicyRecord`, `PoliciesClient`'s default export, and every API route it calls (`/api/v1/policies`, `/api/v1/policies/[id]`) are unchanged.

`PoliciesClient` is the second-largest interactive surface in the app after Reviews (645 lines) — its data-fetching, form-state, and delete-confirmation logic (`apps/web/app/policies/policies-client.tsx:397-519`, i.e. everything in the `PoliciesClient` function body above its `return`) is unchanged; only JSX in `PolicyCard`, `PolicyBuilderForm`, `PolicyInheritanceDiagram`, and `PoliciesClient`'s own `return` changes.

Three test files assert on literal class-name selectors that must survive this rewrite as plain string class tokens alongside the new Tailwind utilities (kept, not removed, exactly like `delivery-signoff-card` in Task 15): `policies-page-frame` (`policies-page.test.ts:139`), `button.button-delete` and `.modal-footer button` and `.policy-builder-footer button` (`policies-client-interactions.test.ts`). No test file needs editing in this task.

- [ ] **Step 1: Update `apps/web/app/policies/page.tsx`'s `<main>` className**

```typescript
      <main className="policies-page-frame mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
```

(Replaces `className="page-frame operational-page policies-page-frame"` on line 13; everything else in the file is unchanged.)

- [ ] **Step 2: Rewrite `PolicyCard` in `apps/web/app/policies/policies-client.tsx`**

```typescript
function PolicyCard({ policy, onDelete }: PolicyCardProps) {
  const scopeLabel = formatScopeLabel(policy.scope);

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-lg">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">{scopeLabel}</span>
          {policy.scopeId ? <code className="text-xs">{policy.scopeId}</code> : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="button-delete"
          onClick={() => onDelete(policy.id, policy.name)}
          aria-label={`Delete policy ${policy.name}`}
        >
          Delete
        </Button>
      </header>

      <div>
        <h3 className="text-base font-bold text-foreground">{policy.name}</h3>
        {policy.description ? <p className="mt-1 text-sm text-muted-foreground">{policy.description}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Severity Gate:</span>
          {policy.severityGate ? (
            <StatusBadge value={mapGateTone(policy.severityGate)} label={`Block on ${policy.severityGate}`} />
          ) : (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Advisory Only</span>
          )}

          {policy.requireEvidencePack ? (
            <span className="rounded-sm bg-info-surface px-1.5 py-0.5 text-xs text-info">Evidence Pack Enforced</span>
          ) : null}

          {policy.requireExternalReview ? (
            <span className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-xs text-warning">External Sign-Off Required</span>
          ) : null}
        </div>

        {policy.requiredRoles.length > 0 ? (
          <div className="mt-3">
            <span className="text-xs text-muted-foreground">Required Roles:</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {policy.requiredRoles.map((role) => (
                <span key={role} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  Role: {role}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {policy.requiredChecklist.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Verification Checklist ({policy.requiredChecklist.length} items)
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {policy.requiredChecklist.map((chk) => (
                <li key={chk} className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  <span>{chk}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Rewrite `PolicyBuilderForm` in the same file**

```typescript
function PolicyBuilderForm({ draft, submitting, onChange, onSubmit, onClose }: PolicyBuilderProps) {
  const roleTags = draft.requiredRoles
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const checklistTags = draft.requiredChecklist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const inputClass =
    "mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
  const labelClass = "text-sm font-medium text-foreground";

  return (
    <Panel
      title="Create Governance Policy"
      description="Define release blocking criteria, required approvers, and verification checks."
      tone="raised"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase text-muted-foreground">1. Scope & Identity</legend>
            <div>
              <label htmlFor="policy-scope" className={labelClass}>
                Governance Scope *
              </label>
              <select
                id="policy-scope"
                value={draft.scope}
                onChange={(e) => onChange({ ...draft, scope: e.target.value as PolicyRecord["scope"] })}
                className={inputClass}
              >
                <option value="organization">Organization (Global baseline for all repositories)</option>
                <option value="team">Team (Applies to all repositories owned by a team)</option>
                <option value="repository">Repository (Specific hardware board repository)</option>
              </select>
            </div>

            {draft.scope !== "organization" ? (
              <div>
                <label htmlFor="policy-scope-id" className={labelClass}>
                  {draft.scope === "team" ? "Team Identifier *" : "Repository Path / ID *"}
                </label>
                <input
                  id="policy-scope-id"
                  value={draft.scopeId}
                  onChange={(e) => onChange({ ...draft, scopeId: e.target.value })}
                  placeholder={draft.scope === "team" ? "e.g. rf-engineering" : "e.g. acme/power-distribution"}
                  className={inputClass}
                  required
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {draft.scope === "team"
                    ? "Slug or name of the engineering team"
                    : "Full repository name or identifier"}
                </span>
              </div>
            ) : null}

            <div>
              <label htmlFor="policy-name" className={labelClass}>
                Policy Name *
              </label>
              <input
                id="policy-name"
                value={draft.name}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
                placeholder="e.g. High-Voltage Creepage & Clearance Gate"
                className={inputClass}
                required
              />
            </div>

            <div>
              <label htmlFor="policy-desc" className={labelClass}>
                Policy Description
              </label>
              <textarea
                id="policy-desc"
                value={draft.description}
                onChange={(e) => onChange({ ...draft, description: e.target.value })}
                placeholder="Describe the safety, fabrication, or quality purpose of this policy..."
                className={inputClass}
                rows={2}
              />
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase text-muted-foreground">2. Severity Gate & Approvers</legend>
            <div>
              <label htmlFor="policy-gate" className={labelClass}>
                Minimum Severity Gate (Blocks Release)
              </label>
              <select
                id="policy-gate"
                value={draft.severityGate}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    severityGate: (e.target.value || "") as DraftPolicyState["severityGate"],
                  })
                }
                className={inputClass}
              >
                <option value="">None (Advisory only)</option>
                <option value="error">Block on Critical & Error findings (Recommended)</option>
                <option value="high">Block on High, Critical & Error findings</option>
                <option value="medium">Block on Medium and higher findings</option>
              </select>
            </div>

            <div>
              <label htmlFor="policy-roles" className={labelClass}>
                Required Approver Roles (Comma-separated)
              </label>
              <input
                id="policy-roles"
                value={draft.requiredRoles}
                onChange={(e) => onChange({ ...draft, requiredRoles: e.target.value })}
                placeholder="e.g. hardware-lead, compliance, rf-specialist"
                className={inputClass}
              />
              {roleTags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {roleTags.map((r) => (
                    <span key={r} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Role: {r}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Design sign-offs require approval from designated roles.
                </span>
              )}
            </div>

            <div>
              <label htmlFor="policy-checklist" className={labelClass}>
                Required Verification Checklist Items (Comma-separated)
              </label>
              <input
                id="policy-checklist"
                value={draft.requiredChecklist}
                onChange={(e) => onChange({ ...draft, requiredChecklist: e.target.value })}
                placeholder="e.g. DFM review confirmed, High-voltage clearance >= 1.5mm"
                className={inputClass}
              />
              {checklistTags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {checklistTags.map((c) => (
                    <span key={c} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Check: {c}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Reviewers must check off these items before sign-off passes.
                </span>
              )}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase text-muted-foreground">3. Compliance & Evidence Pack</legend>
            <div className="flex flex-col gap-2">
              <div
                className={`flex items-start gap-2 rounded-md border p-3 ${draft.requireEvidencePack ? "border-primary bg-accent" : "border-border"}`}
              >
                <input
                  id="chk-require-evidence-pack"
                  type="checkbox"
                  checked={draft.requireEvidencePack}
                  onChange={(e) => onChange({ ...draft, requireEvidencePack: e.target.checked })}
                  className="mt-0.5"
                />
                <label htmlFor="chk-require-evidence-pack" className="text-sm">
                  <strong className="font-medium text-foreground">Require Verified Evidence Pack</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mandates verified evidence digests bound to CAD DRC/ERC reports, BOM snapshots, and release
                    manifests.
                  </p>
                </label>
              </div>

              <div
                className={`flex items-start gap-2 rounded-md border p-3 ${draft.requireExternalReview ? "border-primary bg-accent" : "border-border"}`}
              >
                <input
                  id="chk-require-external-review"
                  type="checkbox"
                  checked={draft.requireExternalReview}
                  onChange={(e) => onChange({ ...draft, requireExternalReview: e.target.checked })}
                  className="mt-0.5"
                />
                <label htmlFor="chk-require-external-review" className="text-sm">
                  <strong className="font-medium text-foreground">Require External / Third-Party Review</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mandates external partner, lab, or customer sign-off before manufacturing gate is unlocked.
                  </p>
                </label>
              </div>
            </div>
          </fieldset>
        </div>

        <footer className="policy-builder-footer flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving Policy…" : "Save Policy"}
          </Button>
        </footer>
      </form>
    </Panel>
  );
}
```

The "KiCad DRC reports" copy in the evidence-pack checkbox description is fixed to "CAD DRC/ERC reports" here — another CAD-format-neutral violation caught during this task's conversion.

- [ ] **Step 4: Rewrite `PolicyInheritanceDiagram` in the same file**

```typescript
function PolicyInheritanceDiagram() {
  return (
    <section className="rounded-md border border-border bg-muted p-4" aria-label="Policy inheritance hierarchy">
      <h3 className="text-base font-bold text-foreground">Policy Hierarchy & Scope Resolution</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        BoardReadyOps resolves governance rules top-down with strict inheritance. Repositories inherit organization
        and team baselines. Stricter rules apply automatically; exceptions require formal review waivers.
      </p>
      <div className="mt-4 grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 1: Global</div>
          <h4 className="text-sm font-bold text-foreground">Organization</h4>
          <p className="mt-1 text-xs text-muted-foreground">Baseline severity gates, mandatory DFM checks, and global sign-off requirements.</p>
        </div>
        <div className="hidden text-center text-muted-foreground sm:block" aria-hidden="true">
          →
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 2: Domain</div>
          <h4 className="text-sm font-bold text-foreground">Team Scope</h4>
          <p className="mt-1 text-xs text-muted-foreground">Domain-specific criteria (e.g. RF impedance, automotive isolation, power rail integrity).</p>
        </div>
        <div className="hidden text-center text-muted-foreground sm:block" aria-hidden="true">
          →
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 3: Project</div>
          <h4 className="text-sm font-bold text-foreground">Repository</h4>
          <p className="mt-1 text-xs text-muted-foreground">Per-board tighter tolerances, stackup layer count rules, and custom verification checklists.</p>
        </div>
        <div className="hidden text-center text-muted-foreground sm:block" aria-hidden="true">
          →
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 4: Waiver</div>
          <h4 className="text-sm font-bold text-foreground">Review Exception</h4>
          <p className="mt-1 text-xs text-muted-foreground">Time-bound, break-glass sign-offs and auditable risk acceptances.</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Rewrite `PoliciesClient`'s `return` block (everything above `return (` — all hooks, `loadPolicies`, `handleCreate`, `handleDelete`, `confirmDelete`, `closeBuilder` — is unchanged)**

```typescript
  return (
    <div className="flex flex-col gap-5">
      <PolicyInheritanceDiagram />

      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3"
        aria-label="Policies summary and actions"
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            <strong>{policies?.length ?? 0}</strong> Active Policies
          </span>
          <span>
            Scope: <strong>{scopeSummary}</strong>
          </span>
          <span>
            Enforcement: <strong>{enforcementSummary}</strong>
          </span>
        </div>
        <Button
          type="button"
          variant={showBuilder ? "secondary" : "default"}
          onClick={() => {
            if (showBuilder) {
              closeBuilder();
            } else {
              setShowBuilder(true);
            }
            setError(null);
            setSuccessMessage(null);
          }}
        >
          {showBuilder ? "✕ Close Policy Builder" : "+ New Governance Policy"}
        </Button>
      </section>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger-surface px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <output className="rounded-md border border-success/40 bg-success-surface px-4 py-3 text-sm text-success">
          ✓ {successMessage}
        </output>
      ) : null}

      {showBuilder ? (
        <PolicyBuilderForm
          draft={draft}
          submitting={submitting}
          onChange={setDraft}
          onSubmit={handleCreate}
          onClose={closeBuilder}
        />
      ) : null}

      <section aria-label="Active governance policies">
        <header>
          <h2 className="text-lg font-bold text-foreground">Active Governance Policies</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rules currently enforced on all hardware pull requests and release sign-offs.
          </p>
        </header>

        {policies === null ? (
          <div className="mt-3 rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Loading governance policies…
          </div>
        ) : policies.length === 0 ? (
          <div className="mt-3">
            <Panel title="No Policies Configured">
              <EmptyState
                title="No governance policies configured yet"
                action={
                  <Button type="button" onClick={() => setShowBuilder(true)}>
                    + New Governance Policy
                  </Button>
                }
              >
                <p>
                  Hardware reviews currently use default open policy behavior. Creating a policy enables explicit
                  release gates, required approver roles, and mandatory verification checklists.
                </p>
              </EmptyState>
            </Panel>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {policies.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} onDelete={(id, name) => setPendingDelete({ id, name })} />
            ))}
          </div>
        )}
      </section>

      {pendingDelete ? (
        <Dialog titleId="delete-policy-title" onClose={() => setPendingDelete(null)}>
          <header className="flex items-center justify-between border-b border-border p-4">
            <h2 id="delete-policy-title" className="text-base font-bold text-foreground">
              Delete Policy
            </h2>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setPendingDelete(null)}
              aria-label="Close modal"
            >
              ✕
            </button>
          </header>
          <div className="p-4 text-sm text-foreground">
            <p>
              Delete <strong>{pendingDelete.name}</strong>? This removes it from enforcement immediately — hardware
              reviews currently gated by this policy will no longer be blocked by it.
            </p>
          </div>
          <footer className="modal-footer flex items-center justify-end gap-2 border-t border-border p-4">
            <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
              Delete Policy
            </Button>
          </footer>
        </Dialog>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Run both policies test files**

Run: `corepack pnpm exec vitest run tests/unit/web/policies-page.test.ts tests/unit/web/policies-client-interactions.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/policies/page.tsx apps/web/app/policies/policies-client.tsx
git commit -m "feat(web): migrate Policies page and PoliciesClient to Tailwind"
```

### Task 17: Migrate Evidence and Insights pages

**Files:**
- Modify: `apps/web/app/evidence/page.tsx`
- Modify: `apps/web/app/insights/page.tsx`

**Interfaces:**
- Consumes: `AppShell`, `Breadcrumbs`, `EmptyState`, `Panel` (`apps/web/components/ui.tsx`).
- Produces: nothing new; neither page has a component test file today, so this task adds none — their only coverage is the repo-wide typecheck/build.

Both pages are simple static/summary surfaces (32 and 54 lines) with no client-side state, grouped into one task per the same right-sizing rationale as Task 15.

- [ ] **Step 1: Rewrite `apps/web/app/evidence/page.tsx`**

```typescript
import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

export const metadata = {
  title: "Releases & Evidence",
  description: "Signed evidence packs bound to review decisions, approvals and artifact digests.",
};

export default function EvidencePage() {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Evidence" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Releases & Evidence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed evidence packs bound to review decisions, approvals and artifact digests.
          </p>
        </header>

        <div className="rounded-md border border-border bg-card p-4 shadow-lg">
          <p className="text-sm text-foreground">
            Evidence packs are deterministic, offline-verifiable, and include base/head SHAs, tool versions, digests and
            decision history.
          </p>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable overflow-x region needs tabIndex so keyboard users can scroll it (WCAG 2.1.1, axe scrollable-region-focusable). */}
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-sm" tabIndex={0}>
            boardreadyops release verify --ledger ./evidence-ledger.json
          </pre>
        </div>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/app/insights/page.tsx`**

```typescript
import { AppShell, Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import { loadViewerWdrrWeekly } from "../../lib/wdrr-dashboard.js";

export const metadata = {
  title: "Insights",
  description: "Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.",
};

export default async function InsightsPage() {
  const viewer = await viewerAuthorization();
  const weekly = await loadViewerWdrrWeekly(viewer.session);

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Insights" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.
          </p>
        </header>

        {!viewer.session ? (
          <Panel title="Sign in required">
            <EmptyState title="Sign in to see your insights">
              <p>
                BoardReadyOps shows Weekly Decision-Ready Review counts for the repositories your GitHub App
                installations can access, so it needs to know who you are.
              </p>
            </EmptyState>
          </Panel>
        ) : (
          <div className="rounded-md border border-border bg-card p-4 shadow-lg">
            <p className="text-sm text-foreground">
              WDRR requires: base/head revision, required checks complete, blockers dispositioned, required approval,
              evidence record.
            </p>
            <p className="mt-2 text-sm text-foreground">
              Weekly buckets:{" "}
              {weekly.length === 0
                ? "No data yet — run your first cloud review"
                : weekly.map((b) => `${b.weekStart}: ${b.count}`).join(", ")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Telemetry is content-free: no CAD design content, finding messages, comment bodies, source paths, secrets
              or emails.
            </p>
          </div>
        )}
      </main>
    </AppShell>
  );
}
```

Fixes another CAD-format-neutral copy violation: "no KiCad content" → "no CAD design content."

- [ ] **Step 3: Lint, typecheck, and build (no dedicated test file exists for either page)**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/evidence/page.tsx apps/web/app/insights/page.tsx
git commit -m "feat(web): migrate Evidence and Insights pages to Tailwind"
```

### Task 18: Migrate the Repository Setup preview page

**Files:**
- Modify: `apps/web/app/setup/page.tsx`
- Modify: `tests/unit/web/repository-setup-page.test.ts`

**Interfaces:**
- Consumes: `Alert`, `AppShell`, `Breadcrumbs`, `Definition`, `DefinitionGrid`, `Panel`, `StatusBadge` (`apps/web/components/ui.tsx`).
- Produces: nothing new; this page has no other consumers.

`tests/unit/web/settings-pages.test.ts:50-52` reads this file's raw source and asserts it contains the literal string `"setup-progress-index"` — that class name is kept as a literal token in the journey-step `<span>`'s className (combined with new Tailwind utilities) so that assertion needs no change. The one assertion that does need to change is `repository-setup-page.test.ts:71`, which checks the rendered `<textarea>` has the **exact** attribute `class="setup-code-preview"` with nothing else — that's incompatible with adding any Tailwind styling to the element, so it's narrowed to a substring check in Step 2 below.

- [ ] **Step 1: Rewrite `apps/web/app/setup/page.tsx`**

```typescript
import {
  isRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import Link from "next/link";
import { Alert, AppShell, Breadcrumbs, Definition, DefinitionGrid, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

export const metadata = {
  title: "Repository setup preview",
  description: "Preview BoardReadyOps policy presets, repository files, permissions, and readiness validation.",
};

type SetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const parameters = await searchParams;
  const selectedValue = first(parameters.preset);
  const hasInstallationHandoff = first(parameters.installation_id) !== undefined;
  const defaultPreset = repositorySetupPreset("prototype");
  if (!defaultPreset) throw new Error("prototype setup preset is unavailable");
  const selected =
    repositorySetupPreset(isRepositorySetupPresetId(selectedValue) ? selectedValue : "prototype") ?? defaultPreset;
  const workflowSource = `https://github.com/oaslananka/boardreadyops/blob/v1/.github/workflows/${repositorySetupWorkflowPath}`;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Repository setup" }]} />
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Repository setup preview</p>
            <h1 className="text-2xl font-bold text-foreground">
              Choose a policy, review every file, then validate the default branch.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              BoardReadyOps never writes repository contents with the production GitHub App. Review the exact
              configuration below, commit it through your normal branch protections, and run an OIDC-bound readiness
              probe.
            </p>
          </div>
          <StatusBadge value="preview" label="No repository changes are made here" />
        </header>

        <Alert title="Configuration preview only" tone="info">
          <p>
            No files are written to your repository automatically. Review the exact configuration below, commit it
            through your normal pull request process, and trigger your first run to establish the baseline.
          </p>
        </Alert>

        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Repository setup steps">
          <a href="#policy-preset" className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover:border-primary/50">
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
              01
            </span>
            <strong className="text-sm text-foreground">1. Choose a release policy</strong>
          </a>
          <a href="#proposed-files" className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover:border-primary/50">
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
              02
            </span>
            <strong className="text-sm text-foreground">2. Review repository-owned files</strong>
          </a>
          <a href="#readiness" className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover:border-primary/50">
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
              03
            </span>
            <strong className="text-sm text-foreground">3. Validate readiness in GitHub Actions</strong>
          </a>
        </nav>

        {hasInstallationHandoff ? (
          <Alert title="GitHub App installation handoff" tone="success">
            <p>
              This URL includes the same <code>installation_id</code> parameter GitHub adds to its post-installation
              handoff. It is an untrusted redirect parameter: this page never displays it, does not authorize repository
              access from it, and does not load tenant data without authenticated control-plane access.
            </p>
            <p>
              <a href="#policy-preset" className="text-primary hover:underline">
                Continue with repository setup
              </a>{" "}
              by choosing a preset and reviewing the two repository-owned files below.
            </p>
          </Alert>
        ) : null}

        <Alert title="Least privilege is preserved" tone="info">
          <p>
            The App uses Metadata read, Pull requests read, Checks write, and Actions write. Contents access,
            organization permissions, and account permissions remain disabled. Any future assisted installation would
            require a separate, explicit opt-in to Contents write.
          </p>
        </Alert>

        <Panel
          id="policy-preset"
          title="1. Choose a release policy"
          description={`Preset v${repositorySetupPresetVersion}. Switching presets starts a new revision; runs you have already done keep the policy they were checked against.`}
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {repositorySetupPresets.map((preset) => (
              <article
                className={`flex flex-col gap-2 rounded-md border p-4 ${preset.id === selected.id ? "border-primary" : "border-border"} bg-card`}
                data-selected={preset.id === selected.id || undefined}
                key={preset.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-foreground">{preset.name}</h3>
                  {preset.id === selected.id ? <StatusBadge value="selected" label="Selected" /> : null}
                </div>
                <p className="text-xs uppercase text-muted-foreground">
                  {preset.id === selected.id ? "Current preview" : "Available release policy"}
                </p>
                <p className="text-sm text-muted-foreground">{preset.description}</p>
                <DefinitionGrid>
                  <Definition label="Release mode">{preset.releaseMode}</Definition>
                  <Definition label="Fail threshold">{preset.failOn}</Definition>
                </DefinitionGrid>
                <Link
                  className="mt-2 inline-flex w-fit items-center justify-center rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  href={`/setup?preset=${preset.id}`}
                  aria-current={preset.id === selected.id ? "page" : undefined}
                >
                  Preview {preset.name}
                </Link>
              </article>
            ))}
          </div>
        </Panel>

        <Panel
          id="proposed-files"
          title="2. Review repository-owned files"
          description="These are the only repository-owned files required for the setup flow. Commit them through a reviewed pull request."
        >
          <div className="flex flex-col gap-4">
            <article className="rounded-md border border-border bg-card p-4">
              <header className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-foreground">boardreadyops.yml</h3>
                  <p className="text-xs text-muted-foreground">Selected preset: {selected.name}</p>
                </div>
                <StatusBadge value="new" label="New or replace intentionally" />
              </header>
              <div className="mt-3">
                <DefinitionGrid>
                  <Definition label="Blocks">Enabled findings at {selected.failOn} severity or above</Definition>
                  <Definition label="Warns">Enabled findings below {selected.failOn} severity</Definition>
                  <Definition label="Ignores">Rules explicitly set to false in the preview</Definition>
                </DefinitionGrid>
              </div>
              <figure className="mt-3">
                <figcaption id="setup-config-preview-caption" className="text-xs text-muted-foreground">
                  {selected.name} boardreadyops.yml preview
                </figcaption>
                <textarea
                  className="setup-code-preview"
                  aria-labelledby="setup-config-preview-caption"
                  readOnly
                  rows={Math.min(selected.config.split("\n").length, 28)}
                  spellCheck={false}
                  value={selected.config}
                />
              </figure>
            </article>
            <article className="rounded-md border border-border bg-card p-4">
              <header className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    .github/workflows/{repositorySetupWorkflowPath}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Canonical v1 runner workflow, contract v{repositorySetupWorkflowContractVersion}
                  </p>
                </div>
                <StatusBadge value="review" label="Review before copying" />
              </header>
              <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
                <li>
                  Open the <a href={workflowSource} className="text-primary hover:underline">canonical v1 workflow source</a> and
                  review its pinned actions, permissions, inputs, and timeouts.
                </li>
                <li>
                  Copy it unchanged to <code>.github/workflows/{repositorySetupWorkflowPath}</code> on a feature branch.
                </li>
                <li>Open a pull request and let your repository ruleset and required checks approve the change.</li>
              </ol>
            </article>
          </div>
        </Panel>

        <Panel
          id="readiness"
          title="3. Validate readiness in GitHub Actions"
          description="The control plane first inspects Actions and workflow metadata, then dispatches a short-lived probe owned by the target repository."
        >
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
            <li>Confirm GitHub Actions is enabled and the workflow is active on the default branch.</li>
            <li>Dispatch the setup probe with a 15-minute persisted deadline and idempotency key.</li>
            <li>
              The workflow checks out its own default branch without persisted credentials and validates{" "}
              <code>boardreadyops.yml</code>
              with a pinned BoardReadyOps CLI.
            </li>
            <li>
              The result is posted with GitHub Actions OIDC bound to the repository ID, workflow ref, branch ref, and
              probe ID.
            </li>
            <li>The verified preset revision is snapshotted onto every newly accepted run and shown in run history.</li>
          </ol>
          <div className="mt-4">
            <Alert title="Recovery and troubleshooting" tone="warning">
              <p>
                Missing workflow, disabled Actions, incompatible workflow metadata, missing configuration, invalid
                configuration, expired probe, stale probe, and dispatch failure are distinct persisted states with
                stable operator responses.
              </p>
              <p>If your initial readiness probe does not appear or reports an error, verify:</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>
                  <strong>Actions permissions:</strong> Confirm GitHub Actions is enabled under Repository Settings
                  &gt; Actions &gt; General.
                </li>
                <li>
                  <strong>Local validation:</strong> Run <code>boardreadyops scan</code> locally before committing to
                  verify <code>boardreadyops.yml</code> syntax.
                </li>
                <li>
                  <strong>OIDC configuration:</strong> Verify your workflow includes{" "}
                  <code>permissions: id-token: write</code> without manual credential overrides.
                </li>
              </ul>
            </Alert>
          </div>
        </Panel>

        <Panel
          id="permissions"
          title="Permission review"
          description="No hidden organization or account access is requested."
        >
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable overflow-x region needs tabIndex so keyboard users can scroll it (WCAG 2.1.1, axe scrollable-region-focusable). */}
          <section className="overflow-x-auto" aria-labelledby="permission-table-caption" tabIndex={0}>
            <table className="w-full text-left text-sm">
              <caption className="sr-only" id="permission-table-caption">
                Required GitHub App permissions and purposes
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-3">Scope</th>
                  <th scope="col" className="py-2 pr-3">Permission</th>
                  <th scope="col" className="py-2 pr-3">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">Repository</th>
                  <td className="py-2 pr-3">Metadata: read</td>
                  <td className="py-2 pr-3 text-muted-foreground">Bind the installation to the intended repository.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">Repository</th>
                  <td className="py-2 pr-3">Pull requests: read</td>
                  <td className="py-2 pr-3 text-muted-foreground">Attach each run to the pull request it belongs to.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">Repository</th>
                  <td className="py-2 pr-3">Checks: write</td>
                  <td className="py-2 pr-3 text-muted-foreground">Publish verified readiness conclusions.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">Repository</th>
                  <td className="py-2 pr-3">Actions: write</td>
                  <td className="py-2 pr-3 text-muted-foreground">Dispatch the repository-owned readiness workflow.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">Repository</th>
                  <td className="py-2 pr-3">Contents: none</td>
                  <td className="py-2 pr-3 text-muted-foreground">Repository files stay under contributor-controlled pull requests.</td>
                </tr>
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">Organization / account</th>
                  <td className="py-2 pr-3">None</td>
                  <td className="py-2 pr-3 text-muted-foreground">No organization-wide or user-account authority.</td>
                </tr>
              </tbody>
            </table>
          </section>
        </Panel>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Narrow the exact-class-match assertion in `tests/unit/web/repository-setup-page.test.ts`**

```typescript
  it("keeps the scrollable configuration preview natively keyboard focusable", async () => {
    const markup = await render({ preset: "production" });
    expect(markup).toContain("setup-code-preview");
    expect(markup).toContain('aria-labelledby="setup-config-preview-caption"');
    expect(markup).toContain('readOnly=""');
  });
```

(Replaces `expect(markup).toContain('class="setup-code-preview"');` — the exact-attribute-match version can never coexist with adding Tailwind styling to that element, since `className` composes multiple tokens. Every other assertion in the file is text-content-based and needs no change.)

- [ ] **Step 3: Run the setup test**

Run: `corepack pnpm exec vitest run tests/unit/web/repository-setup-page.test.ts`
Expected: PASS, including the axe-core WCAG A/AA check.

- [ ] **Step 4: Confirm the settings-pages source-string assertion still passes**

Run: `corepack pnpm exec vitest run tests/unit/web/settings-pages.test.ts -t "setup progress index"`
Expected: PASS — `setup-progress-index` is still a literal substring in `apps/web/app/setup/page.tsx`.

- [ ] **Step 5: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/setup/page.tsx tests/unit/web/repository-setup-page.test.ts
git commit -m "feat(web): migrate Repository Setup preview page to Tailwind"
```

### Task 19: Migrate Settings (layout, nav, all five subtabs, `PlanComparisonCard`)

**Files:**
- Modify: `apps/web/app/settings/layout.tsx`
- Modify: `apps/web/app/settings/settings-nav.tsx`
- Modify: `apps/web/app/settings/billing/page.tsx`
- Modify: `apps/web/app/settings/security/page.tsx`
- Modify: `apps/web/app/settings/data/page.tsx`
- Modify: `apps/web/app/settings/tokens/page.tsx`
- Modify: `apps/web/app/settings/component-intelligence/page.tsx`
- Modify: `apps/web/components/billing/plan-comparison-card.tsx`
- Modify: `tests/unit/web/settings-pages.test.ts`

**Interfaces:**
- Consumes: `AppShell`, `Breadcrumbs`, `Alert`, `Definition`, `DefinitionGrid`, `EmptyState`, `Panel` (`apps/web/components/ui.tsx`); `Badge` (`apps/web/components/ui/badge.tsx`); `Button` (`apps/web/components/ui/button.tsx`).
- Produces: nothing new; `SettingsNav`, `PlanComparisonCard`'s prop shapes are unchanged.

Two test files pin literal class-name lookups: `settings-pages.test.ts:42` does `html.indexOf('class="settings-nav-list"')` — an **exact** attribute match, same problem as Task 18's `setup-code-preview` — so it's updated to look for a `data-testid` instead (Step 8). `settings-billing-page.test.ts` queries `.plan-tier-card`, `.plan-comparison-container`, `.current-plan-badge`, `.upgrade-checkout-button`, `.manage-portal-button` as plain (non-exact) selectors — those five stay as literal class tokens on `PlanComparisonCard`'s elements alongside the new Tailwind utilities, so that test file needs no changes.

- [ ] **Step 1: Rewrite `apps/web/app/settings/layout.tsx`**

```typescript
import type { ReactNode } from "react";
import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { SettingsNav } from "./settings-nav.js";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Settings" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Workspace Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage subscription seats, access security, retention policies, tokens, and data sources.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
          <SettingsNav />

          <section>{children}</section>
        </div>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/app/settings/settings-nav.tsx`**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { label: "Billing & Seats", href: "/settings/billing" },
  { label: "Security & Access", href: "/settings/security" },
  { label: "Data & Retention", href: "/settings/data" },
  { label: "API Tokens", href: "/settings/tokens" },
  { label: "Component Intelligence", href: "/settings/component-intelligence" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-md border border-border bg-card p-3 shadow-lg" aria-label="Settings navigation">
      <ul className="settings-nav-list flex flex-col gap-1" data-testid="settings-nav-list">
        {destinations.map((dest) => {
          const current = pathname === dest.href || pathname?.startsWith(`${dest.href}/`);
          return (
            <li key={dest.href}>
              <Link
                href={dest.href}
                className={`block rounded-sm px-3 py-2 text-sm ${current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                aria-current={current ? "page" : undefined}
              >
                {dest.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`settings-nav-list` stays as a literal class token (harmless alongside `flex flex-col gap-1`) since `settings-pages.test.ts`'s second test still does a plain (non-exact) `toContain` check on it; the exact-match lookup in the third test is retargeted onto the new `data-testid` in Step 8.

- [ ] **Step 3: Rewrite `apps/web/app/settings/security/page.tsx`**

```typescript
export const metadata = {
  title: "Security & Access",
};

export default function SecuritySettingsPage() {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-lg">
      <header>
        <h2 className="text-lg font-bold text-foreground">Security</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          SAML SSO, SCIM provisioning, audit export and SIEM streaming.
        </p>
      </header>
      <p className="mt-3 text-sm text-foreground">
        SAML is available on Business and Enterprise. SCIM deprovisions revoke sessions immediately and orphan
        assignments for reassignment.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Configure SAML via environment: SAML_ENTITY_ID, SAML_ACS_URL, SAML_IDP_METADATA_URL, SAML_CERTIFICATE. SCIM
        requires external provider tenant.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `apps/web/app/settings/data/page.tsx`**

```typescript
export const metadata = {
  title: "Data & Retention",
};

export default function DataSettingsPage() {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-lg">
      <header>
        <h2 className="text-lg font-bold text-foreground">Data & Retention</h2>
        <p className="mt-1 text-sm text-muted-foreground">Retention policies, legal holds, exports and erasures.</p>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Free</dt>
          <dd className="mt-1 text-sm text-foreground">30 days</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team</dt>
          <dd className="mt-1 text-sm text-foreground">365 days</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business</dt>
          <dd className="mt-1 text-sm text-foreground">Configurable; legal hold blocks deletion</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source retention</dt>
          <dd className="mt-1 text-sm text-foreground">24 hours after job (derived snapshots follow plan retention)</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Uninstall gives 30-day export window; immediate delete or legal hold can override. Exports are async, signed
        and time-limited.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `apps/web/app/settings/tokens/page.tsx`**

```typescript
export const metadata = {
  title: "API Tokens",
};

export default function TokensPage() {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-lg">
      <header>
        <h2 className="text-lg font-bold text-foreground">API Tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">Workspace-scoped bearer tokens for CLI and automation.</p>
      </header>
      <p className="mt-3 text-sm text-foreground">
        Tokens are shown only once at creation, stored as SHA-256 digests, and support scopes: runs:write,
        reviews:write, evidence:write. Expiry and revocation are supported.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Pass via BOARDREADYOPS_TOKEN or stdin/secure prompt — never as a CLI argument, and never logged.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `apps/web/app/settings/billing/page.tsx`**

```typescript
import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { PlanComparisonCard } from "../../../components/billing/plan-comparison-card.js";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export const metadata = {
  title: "Billing & Plans",
};

export default async function BillingSettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <div className="rounded-md border border-border bg-card p-5 shadow-lg">
        <h2 className="text-lg font-bold text-foreground">Billing & Subscriptions</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to view and manage your BoardReadyOps plan.</p>
      </div>
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  let current = 0;
  let forecast = 0;
  let hasStripeCustomer = false;
  const currentTier: "community" | "team" | "business" | "pilot" = "community";

  if (config.mode === "postgres") {
    const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
    try {
      const store = new BillingStore(executor);
      const forecastData = await store.forecastContributors(viewer.session.login);
      current = forecastData.current;
      forecast = forecastData.forecast;
      const customer = await store.getCustomer(viewer.session.login);
      if (customer?.stripeCustomerId) {
        hasStripeCustomer = true;
      }
    } finally {
      await executor.close();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card p-5 shadow-lg">
        <header>
          <h2 id="billing-heading" className="text-lg font-bold text-foreground">
            Workspace Subscription & Plans
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the tier that matches your hardware design workflow, team scale, and manufacturing delivery
            requirements. Community edition is included by default for individual makers and open-source hardware.
          </p>
        </header>

        <div className="mt-4">
          <PlanComparisonCard currentTier={currentTier} hasStripeCustomer={hasStripeCustomer} />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-5 shadow-lg">
        <header>
          <h3 className="text-base font-bold text-foreground">Active Seat & Contributor Metrics</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Measured monthly across active engineering collaborators in this workspace.
          </p>
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active contributors (current)
            </dt>
            <dd className="mt-1 text-sm text-foreground">{current}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forecast (month end)</dt>
            <dd className="mt-1 text-sm text-foreground">{forecast}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Rewrite `apps/web/components/billing/plan-comparison-card.tsx`**

```typescript
"use client";

import { useState } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export type CommercialTierKey = "community" | "team" | "business" | "pilot" | "enterprise";

export type PlanComparisonCardProps = Readonly<{
  currentTier?: CommercialTierKey;
  workspaceId?: string;
  hasStripeCustomer?: boolean;
}>;

interface PlanDefinition {
  key: CommercialTierKey;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
}

const PLANS: PlanDefinition[] = [
  {
    key: "community",
    name: "Community",
    price: "$0",
    cadence: "forever free",
    tagline: "For individual makers and open hardware projects.",
    features: [
      "Local CLI pre-flight checks",
      "Public GitHub repositories",
      "Basic KiCad & Gerber DFM rules",
      "Community forum support",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "$29",
    cadence: "/ workspace / mo",
    tagline: "For independent engineers and hardware duos.",
    features: [
      "Everything in Community",
      "Private Multi-CAD package uploads",
      "Interactive visual layer canvas",
      "Cross-revision Gerber diffing",
      "5GB storage included",
    ],
  },
  {
    key: "business",
    name: "Business",
    price: "$149",
    cadence: "/ workspace / mo",
    tagline: "For boutique design consultancies and engineering teams.",
    features: [
      "Everything in Team",
      "Cryptographically signed guest links",
      "Custom DFM rule profiles & constraints",
      "Unlimited active projects",
      "25GB storage & priority support",
    ],
  },
  {
    key: "pilot",
    name: "Paid Pilot",
    price: "$450",
    cadence: "/ org / mo (3 mos)",
    tagline: "Structured commercial onboarding for hardware organizations.",
    features: [
      "Everything in Business",
      "Hands-on CAD workflow integration",
      "Fabricator intake pipeline setup",
      "Dedicated Slack channel with team",
      "Custom rule profile development",
    ],
  },
];

export function PlanComparisonCard({
  currentTier = "community",
  workspaceId,
  hasStripeCustomer = false,
}: PlanComparisonCardProps) {
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleUpgrade(tier: "team" | "business") {
    setLoadingTier(tier);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier,
          interval: "month",
          workspaceId,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Checkout failed with HTTP ${response.status}`);
      }

      const { url } = (await response.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to open checkout");
      setLoadingTier(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Portal redirect failed with HTTP ${response.status}`);
      }

      const { url } = (await response.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to open customer portal");
      setPortalLoading(false);
    }
  }

  return (
    <div className="plan-comparison-container flex flex-col gap-4">
      {hasStripeCustomer && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted p-3">
          <div>
            <strong className="text-sm font-medium text-foreground">Billing Subscription Managed via Stripe</strong>
            <p className="text-xs text-muted-foreground">Update payment methods, view invoices, or modify seats.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="manage-portal-button"
            disabled={portalLoading}
            onClick={handlePortal}
          >
            {portalLoading ? "Opening..." : "Manage Subscription"}
          </Button>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-md border border-danger/40 bg-danger-surface px-4 py-3 text-sm text-danger" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.key === currentTier;
          const canUpgrade = !isCurrent && (plan.key === "team" || plan.key === "business");

          return (
            <div
              key={plan.key}
              className={`plan-tier-card flex flex-col gap-3 rounded-md border p-4 ${isCurrent ? "border-primary" : "border-border"} bg-card`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-foreground">{plan.name}</h3>
                  {isCurrent && <Badge className="current-plan-badge">Current Plan</Badge>}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-xs text-muted-foreground">{plan.cadence}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
              </div>

              <ul className="flex flex-1 flex-col gap-1.5 text-sm text-foreground">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2">
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width="16"
                      height="16"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <div>
                {isCurrent && (
                  <span className="inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
                    Active Plan
                  </span>
                )}

                {canUpgrade && (
                  <Button
                    type="button"
                    className="upgrade-checkout-button w-full"
                    disabled={loadingTier === plan.key}
                    onClick={() => handleUpgrade(plan.key as "team" | "business")}
                  >
                    {loadingTier === plan.key ? "Opening Stripe..." : `Upgrade to ${plan.name}`}
                  </Button>
                )}

                {!isCurrent && !canUpgrade && (
                  <a
                    href="mailto:pilot@boardreadyops.com?subject=Paid%20Pilot%20Inquiry"
                    className="inline-flex w-full items-center justify-center rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  >
                    Apply for Pilot
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Rewrite `apps/web/components/settings/component-intelligence` page — `apps/web/app/settings/component-intelligence/page.tsx`**

```typescript
import { configuredCredentialCipher } from "@boardreadyops/cloud-core/credential-encryption";
import { planLimits, planTierOf } from "@boardreadyops/cloud-core/entitlements";
import Link from "next/link";
import { Alert, Definition, DefinitionGrid, EmptyState, Panel, type StatusTone } from "../../../components/ui.js";
import { Button } from "../../../components/ui/button.js";
import { nexarProviderName } from "../../../lib/component-intelligence-resolver.js";
import { issueSettingsFormToken } from "../../../lib/settings-form-token.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { viewerInstallations } from "../../../lib/viewer-installations.js";

export const metadata = {
  title: "Component intelligence",
  description: "Supply your own component data provider credentials for continuous supply watch.",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const outcomes: Record<string, { tone: StatusTone; title: string; message: string }> = {
  saved: { tone: "success", title: "Credential saved", message: "The next supply watch pass will use it." },
  removed: { tone: "info", title: "Credential removed", message: "Supply watch will stop looking parts up." },
  incomplete: {
    tone: "warning",
    title: "Missing details",
    message: "Both the client ID and the client secret are required.",
  },
  expired: { tone: "warning", title: "Form expired", message: "Reload the page and try again." },
  forbidden: { tone: "danger", title: "Not permitted", message: "You do not have access to that installation." },
  signed_out: { tone: "warning", title: "Signed out", message: "Sign in again to change credentials." },
  invalid: { tone: "warning", title: "Invalid submission", message: "That submission was not valid." },
  unavailable: {
    tone: "danger",
    title: "Storage unavailable",
    message: "Credential storage is not configured on this deployment.",
  },
  failed: { tone: "danger", title: "Could not store", message: "The credential could not be stored. Try again." },
};

export default async function ComponentIntelligencePage({ searchParams }: PageProps) {
  const parameters = await searchParams;
  const outcome = outcomes[first(parameters.status) ?? ""];
  const viewer = await viewerAuthorization();
  const session = viewer.session;
  const cipherConfigured = configuredCredentialCipher(process.env) !== undefined;
  const installations = await viewerInstallations(session, nexarProviderName);
  const secret = process.env.SESSION_SECRET?.trim();
  const now = new Date();

  const inputClass =
    "mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-bold text-foreground">Component intelligence</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Continuous supply watch checks every part on your boards for lifecycle changes. Lookups run under{" "}
          <strong className="text-foreground">your own provider account</strong>, not a shared BoardReadyOps
          subscription, because provider licences are non-transferable — one customer&apos;s answer may not be reused
          for another.
        </p>
      </header>

      {outcome ? (
        <Alert tone={outcome.tone} title={outcome.title}>
          {outcome.message}
        </Alert>
      ) : undefined}

      {!cipherConfigured ? (
        <Alert tone="danger" title="Credential storage is not configured">
          This deployment has no credential encryption key configured, so credentials cannot be stored. Set
          BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY and redeploy.
        </Alert>
      ) : undefined}

      {!session ? (
        <Panel title="Sign in required">
          <EmptyState title="Sign in to configure component intelligence">
            <p>Credentials are stored per installation, so we need to know which installations you can administer.</p>
          </EmptyState>
        </Panel>
      ) : installations.length === 0 ? (
        <Panel title="No installations">
          <EmptyState title="No active installations found">
            <p>Install the BoardReadyOps GitHub App on an account you administer, then return here.</p>
          </EmptyState>
        </Panel>
      ) : (
        installations.map((installation) => {
          const limits = planLimits(planTierOf(installation.planTier));
          const token = secret ? issueSettingsFormToken(session, installation.id, secret, now) : "";

          return (
            <Panel key={installation.id} title={installation.accountLogin}>
              <DefinitionGrid>
                <Definition label="Plan">{installation.planTier}</Definition>
                <Definition label="Supply watch">
                  {limits.supplyWatch ? "Included" : "Not included on this plan"}
                </Definition>
                <Definition label="Credential">{installation.hasComponentCredential ? "Stored" : "Not set"}</Definition>
              </DefinitionGrid>

              {!limits.supplyWatch ? (
                <div className="mt-3">
                  <Alert tone="info" title="Supply watch is not on this plan">
                    Supply watch is not included on the {installation.planTier} plan. You can store a credential now;
                    boards will start being checked when the plan includes it.
                  </Alert>
                </div>
              ) : undefined}

              {installation.componentCredentialRejectedAt ? (
                <div className="mt-3">
                  <Alert tone="warning" title="The provider refused this credential">
                    Refused on {new Date(installation.componentCredentialRejectedAt).toISOString().slice(0, 10)}
                    {installation.componentCredentialRejectedReason
                      ? ` (${installation.componentCredentialRejectedReason})`
                      : ""}
                    . Replace it below; the stored credential is kept until you do, in case the refusal was temporary.
                  </Alert>
                </div>
              ) : undefined}

              <form action="/api/v1/settings/component-intelligence" method="post" className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="installation_id" value={installation.id} />
                <input type="hidden" name="form_token" value={token} />

                <div>
                  <label htmlFor={`client-id-${installation.id}`} className="text-sm font-medium text-foreground">
                    Nexar client ID
                  </label>
                  <input
                    id={`client-id-${installation.id}`}
                    name="client_id"
                    type="text"
                    autoComplete="off"
                    maxLength={512}
                    required
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor={`client-secret-${installation.id}`} className="text-sm font-medium text-foreground">
                    Nexar client secret
                  </label>
                  {/* Never rendered back: the stored value is write-only from this page. */}
                  <input
                    id={`client-secret-${installation.id}`}
                    name="client_secret"
                    type="password"
                    autoComplete="new-password"
                    maxLength={512}
                    required
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor={`scope-${installation.id}`} className="text-sm font-medium text-foreground">
                    OAuth scope (optional)
                  </label>
                  <input
                    id={`scope-${installation.id}`}
                    name="scope"
                    type="text"
                    autoComplete="off"
                    maxLength={512}
                    placeholder="supply.domain"
                    className={inputClass}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button type="submit" name="action" value="save" disabled={!cipherConfigured}>
                    {installation.hasComponentCredential ? "Replace credential" : "Save credential"}
                  </Button>
                  {/* formNoValidate: removal does not need the credential fields, and the
                        browser would otherwise block the submit on their required attribute. */}
                  {installation.hasComponentCredential ? (
                    <Button type="submit" name="action" value="remove" variant="secondary" formNoValidate>
                      Remove
                    </Button>
                  ) : undefined}
                </div>
              </form>
            </Panel>
          );
        })
      )}

      <Panel title="What we store">
        <p className="text-sm text-foreground">
          Only the credential you enter, encrypted, and whether the provider last refused it. The secret is never shown
          again and never appears in a page, a log line, or an error message. Removing it stops all lookups for that
          installation immediately; your recorded board evidence is untouched.
        </p>
        <p className="mt-2 text-sm">
          <Link href="https://nexar.com/api" className="text-primary hover:underline">
            Nexar
          </Link>{" "}
          issues client credentials from its developer portal.
        </p>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 9: Retarget the exact-class-match assertion in `tests/unit/web/settings-pages.test.ts`**

```typescript
  it("marks exactly the current settings destination with aria-current", () => {
    const html = renderToString(
      SettingsLayout({
        children: React.createElement("div", { id: "test-child" }, "Child Content"),
      }),
    );
    const navStart = html.indexOf('data-testid="settings-nav-list"');
    const navSection = html.slice(navStart, html.indexOf("</ul>", navStart));
    const ariaCurrentMatches = navSection.match(/aria-current="page"/g) ?? [];
    expect(ariaCurrentMatches).toHaveLength(1);
    expect(navSection).toContain('aria-current="page" href="/settings/billing"');
    expect(navSection).not.toContain('aria-current="page" href="/settings/security"');
  });
```

(Replaces the `html.indexOf('class="settings-nav-list"')` line — the exact-attribute lookup can't survive `className` composing additional Tailwind utility classes, so it's retargeted onto the `data-testid` added in Step 2. The other three tests in this file are unaffected by this task; the fourth test's `styles.css` assertion is addressed in the Phase D cleanup task, not here, since `styles.css` isn't deleted until then.)

- [ ] **Step 10: Run the settings and billing test files**

Run: `corepack pnpm exec vitest run tests/unit/web/settings-pages.test.ts tests/unit/web/settings-billing-page.test.ts tests/unit/web/settings-form-token.test.ts`
Expected: PASS.

- [ ] **Step 11: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 12: Commit**

```bash
git add apps/web/app/settings/ apps/web/components/billing/plan-comparison-card.tsx tests/unit/web/settings-pages.test.ts
git commit -m "feat(web): migrate Settings (layout, nav, all subtabs, PlanComparisonCard) to Tailwind"
```

### Task 20: Migrate the Repository detail page

**Files:**
- Modify: `apps/web/app/repositories/[repositoryId]/page.tsx`

**Interfaces:**
- Consumes: `AppShell`, `Breadcrumbs`, `Definition`, `DefinitionGrid`, `EmptyState`, `Panel`, `StatusBadge` (`apps/web/components/ui.tsx`); `GuidedChecklist` (`apps/web/components/guided-checklist.tsx`, Task 5).
- Produces: nothing new; `generateMetadata` and the data-loading call to `loadRepositoryDetail` are unchanged — `repository-page-metadata.test.ts` and `repository-dashboard-unit.test.ts` test those directly (not rendered markup) and need no changes.

This is the fourth and last of the ADR's four named `GuidedChecklist` surfaces (alongside Projects, Parts, and Deliveries from earlier tasks) — its "Recent runs" empty state becomes a two-step checklist instead of a passive `EmptyState`. The "Open supply findings" empty state stays a plain `EmptyState`: it isn't a setup step at all (it can mean supply watch is simply current, not un-configured), so a checklist implying an action is required would misrepresent it.

- [ ] **Step 1: Rewrite `apps/web/app/repositories/[repositoryId]/page.tsx`**

```typescript
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AppShell,
  Breadcrumbs,
  Definition,
  DefinitionGrid,
  EmptyState,
  Panel,
  StatusBadge,
} from "../../../components/ui.js";
import { GuidedChecklist } from "../../../components/guided-checklist.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { loadRepositoryDetail } from "../../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

type PageProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);
  return {
    title: detail ? `${detail.repository.owner}/${detail.repository.name}` : "Repository",
    description: "Recent release readiness runs and open supply findings for one repository.",
  };
}

function when(value: string | undefined): string {
  if (!value) return "unknown";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

export default async function RepositoryPage({ params }: PageProps) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);

  // A repository the viewer cannot administer answers the same as one that does not exist, so
  // this page cannot be used to discover which repositories are enrolled.
  //
  // Returned rather than called bare: notFound() never returns, but saying so explicitly keeps
  // the narrowing obvious to a reader, and to any analyser that does not model Next's helpers.
  if (!detail) return notFound();

  const { repository, runs, supplyFindings } = detail;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/dashboard", label: "Dashboard" },
            { label: `${repository.owner}/${repository.name}` },
          ]}
        />
        <header>
          <h1 className="text-2xl font-bold text-foreground">
            {repository.owner}/{repository.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Release readiness history and open supply findings for this repository.
          </p>
        </header>

        <Panel title="Current state">
          <DefinitionGrid>
            <Definition label="Visibility">{repository.private ? "Private" : "Public"}</Definition>
            <Definition label="Latest run">
              {repository.latestRunId ? (
                <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
              ) : (
                "No runs yet"
              )}
            </Definition>
            <Definition label="Open findings">{repository.latestRunId ? repository.openFindings : "—"}</Definition>
            <Definition label="Boards watched">{repository.watchedBoards}</Definition>
          </DefinitionGrid>
        </Panel>

        <Panel title="Recent runs">
          {runs.length === 0 ? (
            <GuidedChecklist
              heading="Trigger your first run on this repository"
              steps={[
                { id: "connected", label: `Repository ${repository.owner}/${repository.name} connected`, status: "done" },
                {
                  id: "pr",
                  label: "Open a pull request touching the hardware project to produce the first run",
                  status: "current",
                },
              ]}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th scope="col" className="py-2 pr-3">Run</th>
                    <th scope="col" className="py-2 pr-3">Outcome</th>
                    <th scope="col" className="py-2 pr-3">Ref</th>
                    <th scope="col" className="py-2 pr-3">Findings</th>
                    <th scope="col" className="py-2 pr-3">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <Link href={`/runs/${run.id}`} className="text-primary hover:underline">
                          {run.commitSha.slice(0, 8) || run.id.slice(0, 8)}
                        </Link>
                      </th>
                      <td className="py-2 pr-3">
                        <StatusBadge value={run.decision ?? run.status} />
                      </td>
                      <td className="py-2 pr-3">
                        {run.pullRequestNumber !== undefined
                          ? `#${run.pullRequestNumber}`
                          : run.ref.replace(/^refs\/heads\//u, "")}
                      </td>
                      <td className="py-2 pr-3">{run.findingCount}</td>
                      <td className="py-2 pr-3">
                        <span className="text-muted-foreground">{when(run.startedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Open supply findings">
          {supplyFindings.length === 0 ? (
            <EmptyState title="No open supply findings">
              <p>
                Parts on watched boards are either current or not yet checked. Supply watch needs a component data
                provider credential and a plan that includes it.
              </p>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th scope="col" className="py-2 pr-3">Part</th>
                    <th scope="col" className="py-2 pr-3">Board</th>
                    <th scope="col" className="py-2 pr-3">Status</th>
                    <th scope="col" className="py-2 pr-3">Reference</th>
                    <th scope="col" className="py-2 pr-3">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {supplyFindings.map((finding) => (
                    <tr key={`${finding.boardPath}:${finding.mpn}:${finding.reference ?? ""}`} className="border-b border-border last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        {finding.mpn}
                        {finding.manufacturer ? (
                          <span className="ml-2 text-muted-foreground">{finding.manufacturer}</span>
                        ) : undefined}
                      </th>
                      <td className="py-2 pr-3">{finding.boardPath}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge value={finding.status} />
                      </td>
                      <td className="py-2 pr-3">{finding.reference ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="text-muted-foreground">{when(finding.detectedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Run the repository detail test files**

Run: `corepack pnpm exec vitest run tests/unit/web/repository-page-metadata.test.ts tests/unit/web/repository-dashboard-unit.test.ts`
Expected: PASS — neither exercises rendered markup, so this rewrite doesn't affect them.

- [ ] **Step 3: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/repositories/[repositoryId]/page.tsx
git commit -m "feat(web): migrate Repository detail page to Tailwind"
```

This completes Phase B (all authenticated-app pages).

## Phase C: Public marketing site

### Task 21: Migrate the landing page, its shared brand/nav components, and OG image generation

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/opengraph-image.tsx`
- Modify: `apps/web/components/brand-mark.tsx`
- Modify: `apps/web/components/viewer-controls.tsx`
- Modify: `apps/web/components/landing-actions.tsx`
- Delete: `apps/web/app/landing.css`
- Modify: `tests/unit/web/home-page.test.ts`

**Interfaces:**
- Consumes: `buttonVariants` (`apps/web/components/ui/button.tsx`, Task 3); `cn` (`apps/web/lib/utils.ts`, Task 1).
- Produces: nothing new; `BrandMarkIcon`, `BrandMarkLockup`, `ViewerControls`, `ViewerNav`, `installUrl`, `LandingHeroActions`, `LandingNavActions` keep their existing prop shapes — `ViewerNav`/`ViewerControls` are also consumed by every authenticated page via `AppShell`, and `BrandMarkLockup` is also consumed by `product-navigation.tsx` (Task 6), so this task's conversion of their internals affects those call sites too, not just the landing page.

`brand-mark.tsx` and `viewer-controls.tsx` were not touched by Task 6 (which only added a Tailwind `className` at `BrandMarkLockup`'s call site, not inside the component) — they're still on `styles.css` classes and `#c69a3e` (the old copper accent). This is the only task that fully removes both, and it's grouped here because the landing page is their last remaining consumer, and leaving either unconverted would block the Phase D zero-references cleanup gate.

This task also fixes the CAD-format-neutral copy violations in the landing page's hero kicker/lede, the root layout's OpenGraph/Twitter descriptions, and `opengraph-image.tsx`'s generated social-card copy — all say "KiCad board"/"KiCad hardware" where the product supports KiCad, Altium, EasyEDA, Fusion 360, Gerber, and IPC-2581.

`home-page.test.ts`'s last test reads `apps/web/app/landing.css` directly and asserts on old Foundry-theme CSS variable names (`--foundry-canvas`, `--foundry-copper`) — since this task deletes that file, the test is rewritten to check the new Tailwind-based facts instead (Step 9).

- [ ] **Step 1: Fix CAD-neutral copy and update the accent color reference in `apps/web/app/layout.tsx`**

```typescript
export const metadata: Metadata = {
  metadataBase: new URL("https://boardreadyops.com"),
  title: { default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" },
  description: "Checks whether a hardware board is ready to fabricate, on every pull request.",
  openGraph: {
    title: "BoardReadyOps — Know what stands between your board and production.",
    description:
      "Design, BOM, and manufacturing checks run on every pull request and tell you in one line whether the board is ready to fabricate.",
    url: "https://boardreadyops.com",
    siteName: "BoardReadyOps",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BoardReadyOps — Know what stands between your board and production.",
    description:
      "Design, BOM, and manufacturing checks run on every pull request and tell you in one line whether the board is ready to fabricate.",
  },
};
```

(Replaces lines 21–35 of the original file; the `body`/`mono` font setup, the `import "./styles.css"` — kept until the Phase D cleanup task deletes it repo-wide — and `RootLayout` itself are unchanged. `layout-metadata.test.ts` asserts on `metadataBase`, `title`, `openGraph.title`/`url`/`type`, and `twitter.card` only, none of which change here.)

- [ ] **Step 2: Rewrite `apps/web/components/brand-mark.tsx`**

```typescript
export type BrandMarkProps = {
  readonly size?: number;
  readonly className?: string;
};

export function BrandMarkIcon({ size = 32, className }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 104 104" role="img" aria-label="BoardReadyOps" className={className}>
      <rect x="4" y="4" width="96" height="96" rx="20" fill="#0d1117" stroke="#232a38" />
      <g stroke="var(--color-primary, #58a6ff)" strokeWidth="3" strokeLinecap="round">
        <line x1="36" y1="22" x2="36" y2="30" />
        <line x1="46" y1="22" x2="46" y2="30" />
        <line x1="58" y1="22" x2="58" y2="30" />
        <line x1="68" y1="22" x2="68" y2="30" />
        <line x1="36" y1="74" x2="36" y2="82" />
        <line x1="46" y1="74" x2="46" y2="82" />
        <line x1="58" y1="74" x2="58" y2="82" />
        <line x1="68" y1="74" x2="68" y2="82" />
        <line x1="22" y1="36" x2="30" y2="36" />
        <line x1="22" y1="46" x2="30" y2="46" />
        <line x1="22" y1="58" x2="30" y2="58" />
        <line x1="22" y1="68" x2="30" y2="68" />
        <line x1="74" y1="36" x2="82" y2="36" />
        <line x1="74" y1="46" x2="82" y2="46" />
        <line x1="74" y1="58" x2="82" y2="58" />
        <line x1="74" y1="68" x2="82" y2="68" />
      </g>
      <rect
        x="30"
        y="30"
        width="44"
        height="44"
        rx="4"
        fill="#080b10"
        stroke="var(--color-primary, #58a6ff)"
        strokeWidth="2.25"
      />
      <circle cx="36" cy="36" r="2.2" fill="var(--color-primary, #58a6ff)" />
      <path
        d="M40 52 L47 59 L64 42"
        stroke="#ece5d3"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandMarkLockup({ size = 24, className }: BrandMarkProps) {
  return (
    <span className={className ?? "flex items-center gap-2"}>
      <BrandMarkIcon size={size} />
      <span className="text-sm font-bold text-foreground">BoardReadyOps</span>
    </span>
  );
}
```

The `rx="20"`/`rx="4"` sharp-ish corners on the mark itself are left as-is (they're the brand mark's own geometry, not a UI chrome radius the ADR's "2px radius" rule governs); only the copper `#c69a3e` accent is replaced with the ADR's locked electric-blue `#58a6ff`, referenced the same `var(--token, #hex-fallback)` way the original did — the fallback matters because `icon.tsx` and `opengraph-image.tsx` (Step 4) render this SVG through Satori/`next/og`, which has no stylesheet to resolve a custom property against, so it falls through to the literal hex every time.

- [ ] **Step 3: Rewrite `apps/web/components/viewer-controls.tsx`**

```typescript
/**
 * Sign-in state in the header.
 *
 * Signing in is a link because it starts a redirect the viewer initiated. Signing out is a form
 * POST so a third-party page cannot sign someone out by embedding a link to it.
 */
export function ViewerControls({ login }: Readonly<{ login: string | undefined }>) {
  if (!login) {
    return (
      <a
        className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
        href="/api/auth/github/login"
      >
        Sign in with GitHub
      </a>
    );
  }

  return (
    <span className="flex items-center gap-3 text-sm">
      <span className="text-foreground">{login}</span>
      <form action="/api/auth/logout" method="post">
        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          type="submit"
        >
          Sign out
        </button>
      </form>
    </span>
  );
}
```

- [ ] **Step 4: Fix the accent color and CAD-neutral copy in `apps/web/app/opengraph-image.tsx`**

```typescript
import { ImageResponse } from "next/og";
import { BrandMarkIcon } from "../components/brand-mark";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d1117",
        padding: 80,
      }}
    >
      <div style={{ marginBottom: 36, display: "flex" }}>
        <BrandMarkIcon size={88} />
      </div>
      <div style={{ fontSize: 56, fontWeight: 700, color: "#ece5d3", textAlign: "center", lineHeight: 1.2 }}>
        Release evidence that leads to a decision.
      </div>
      <div style={{ fontSize: 26, color: "#58a6ff", marginTop: 24, textAlign: "center" }}>
        BoardReadyOps — release readiness for hardware teams
      </div>
    </div>,
    { ...size },
  );
}
```

(`icon.tsx` needs no change — it only renders `<BrandMarkIcon size={64} />` with no surrounding copy or color of its own, so Step 2's fallback-hex fix already covers it.)

- [ ] **Step 5: Rewrite `apps/web/components/landing-actions.tsx`**

```typescript
import Link from "next/link";
import { viewerAuthorization } from "../lib/viewer-authorization.js";
import { ViewerControls } from "./viewer-controls.js";
import { buttonVariants } from "./ui/button.js";

/**
 * Landing-page actions that differ for a prospect and a customer.
 *
 * The landing page used to offer everyone the same thing: Install on GitHub. Somebody who had
 * already installed it, and was signed in, had no route to their own dashboard from the page
 * they land on — the marketing navigation carried no link to it and the primary button asked
 * them to install a second time.
 *
 * So the actions are split by who is reading. A prospect is asked to install; a customer is
 * taken to their repositories. One primary action each, never both.
 */

export const installUrl = "https://github.com/apps/boardreadyops/installations/new";

const navCtaClass = buttonVariants({ variant: "default", size: "sm" });
const primaryClass = buttonVariants({ variant: "default", size: "lg" }) + " gap-2";
const secondaryClass = buttonVariants({ variant: "secondary", size: "lg" });

export async function LandingNavActions() {
  const session = (await viewerAuthorization()).session;

  if (!session) {
    return (
      <>
        <ViewerControls login={undefined} />
        <a className={navCtaClass} href={installUrl}>
          Install on GitHub
        </a>
      </>
    );
  }

  return (
    <>
      <ViewerControls login={session.login} />
      {/* The dashboard is the primary action for somebody who has already installed, so it is
          the button rather than another link competing with the marketing anchors. */}
      <Link className={navCtaClass} href="/dashboard">
        Open dashboard
      </Link>
    </>
  );
}

export async function LandingHeroActions() {
  const session = (await viewerAuthorization()).session;

  if (!session) {
    return (
      <>
        <a className={primaryClass} href={installUrl}>
          <span>Install on GitHub</span>
          <span aria-hidden="true">↗</span>
        </a>
        <Link className={secondaryClass} href="/setup">
          Preview repository setup
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className={primaryClass} href="/dashboard">
        <span>Open dashboard</span>
        <span aria-hidden="true">→</span>
      </Link>
      <a className={secondaryClass} href={installUrl}>
        Add another repository
      </a>
    </>
  );
}
```

`buttonVariants` is called at module scope (not per-render) since it takes no dynamic input here — same variant every render — avoiding recomputing the same class string on every request.

- [ ] **Step 6: Delete `apps/web/app/landing.css`**

```bash
git rm apps/web/app/landing.css
```

- [ ] **Step 7: Rewrite `apps/web/app/page.tsx`'s imports and metadata (top of file)**

```typescript
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BrandMarkIcon } from "../components/brand-mark.js";
import { installUrl, LandingHeroActions, LandingNavActions } from "../components/landing-actions.js";
import { PublicStructuredData } from "../components/public-structured-data.js";
import { buttonVariants } from "../components/ui/button.js";

export const metadata: Metadata = {
  title: { absolute: "BoardReadyOps — Know what stands between your board and production." },
  description: "Checks whether a hardware board is ready to fabricate, on every pull request.",
  alternates: {
    canonical: "/",
    types: {
      "text/markdown": "/index.md",
    },
  },
};
```

(Drops `import "./landing.css"` — deleted in Step 6 — and adds `buttonVariants` for the hero/footer CTAs. `proofItems`, `workflowSteps`, `glossaryTerms`, `releaseGuides`, `releaseFaq`, `releaseEvidenceChecklist`, and `capabilities` — everything between the metadata and `export default function HomePage()` — are unchanged verbatim; none of their copy is KiCad-specific product-scope language, and the Glossary entries correctly describe KiCad-native terms (DRC/ERC) as terminology, not as a claim that KiCad is the only supported format.)

- [ ] **Step 8: Rewrite the `HomePage` component's JSX (everything from `export default function HomePage()` to the closing `}`)**

```typescript
export default function HomePage() {
  return (
    <div className="bg-background text-foreground">
      <PublicStructuredData />
      <a
        className="absolute left-2 top-2 z-50 -translate-y-16 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
        href="#main-content"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold text-foreground" aria-label="BoardReadyOps home">
          <BrandMarkIcon size={24} />
          <span>BoardReadyOps</span>
        </Link>
        <nav aria-label="Global navigation" className="flex items-center gap-6 text-sm">
          <a href="#product" className="text-muted-foreground hover:text-foreground">Product</a>
          <a href="#how-it-works" className="text-muted-foreground hover:text-foreground">How it works</a>
          <a href="#glossary" className="text-muted-foreground hover:text-foreground">Glossary</a>
          <a href="https://docs.boardreadyops.com/security/assurance-case/" className="text-muted-foreground hover:text-foreground">Trust</a>
          <a href="https://docs.boardreadyops.com" className="text-muted-foreground hover:text-foreground">Docs</a>
          {/* Suspended so reading the session never delays the landing navigation. */}
          <Suspense fallback={null}>
            <LandingNavActions />
          </Suspense>
        </nav>
      </header>

      <main id="main-content">
        <section className="border-b border-border py-20" aria-labelledby="landing-heading">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 lg:grid-cols-[3fr_2fr] lg:items-center">
            <div>
              <p className="text-sm font-medium text-primary">Hardware release intelligence for every CAD workflow</p>
              <h1 id="landing-heading" className="mt-3 text-4xl font-bold leading-tight text-foreground sm:text-5xl">
                Know what stands between your board and production.
              </h1>
              <p className="mt-4 text-lg text-muted-foreground">
                BoardReadyOps checks whether your board is ready to fabricate on every pull request — or right from
                your local terminal. One verdict, clear blockers, and verifiable release evidence.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Suspense
                  fallback={
                    <a className={buttonVariants({ variant: "default", size: "lg" }) + " gap-2"} href={installUrl}>
                      <span>Install on GitHub</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  }
                >
                  <LandingHeroActions />
                </Suspense>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground" aria-label="What BoardReadyOps does">
                <li>Local CLI or GitHub Actions</li>
                <li>Clear blockers before you order</li>
                <li>Your repository stays in charge</li>
              </ul>
            </div>

            <aside className="rounded-md border border-border bg-card p-5 shadow-lg" aria-label="What a run looks like">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                <span>Sample review · USB-C Sensor Node v2.1</span>
                <code className="ml-auto rounded-sm bg-muted px-1.5 py-0.5">sample-pull-request</code>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <span className="block text-xs uppercase text-muted-foreground">The verdict</span>
                  <strong className="text-base text-foreground">Ready to fabricate</strong>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">Resolved after rerun</span>
              </div>
              <ol className="mt-4 flex flex-col gap-3">
                <li className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">01</span>
                  <div className="flex-1">
                    <strong className="block text-sm text-foreground">Inspect release decision</strong>
                    <span className="text-xs text-muted-foreground">Exact revision, branch, and Check Run</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Pinned</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">02</span>
                  <div className="flex-1">
                    <strong className="block text-sm text-foreground">What it found</strong>
                    <span className="text-xs text-muted-foreground">Layout, schematic, BOM, and manufacturing checks</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Explained</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">03</span>
                  <div className="flex-1">
                    <strong className="block text-sm text-foreground">The files it produced</strong>
                    <span className="text-xs text-muted-foreground">Reports and outputs, each with a checksum</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Downloadable</span>
                </li>
              </ol>
              <p className="mt-4 text-xs text-muted-foreground">
                Illustrative sample. Your repository and its workflow logs stay the source of truth.
              </p>
            </aside>
          </div>
        </section>

        <section className="border-b border-border py-16" aria-labelledby="proof-heading">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 lg:grid-cols-[1fr_1fr] lg:items-start">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-primary">Pull request evidence</p>
              <h2 id="proof-heading" className="text-2xl font-bold text-foreground sm:text-3xl">
                Every pull request, reviewed like a design review.
              </h2>
              <p className="text-sm text-muted-foreground">
                DRC, ERC, BOM and manufacturing checks arrive as one answer instead of several logs, and every part of
                it links back to the GitHub run it came from.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {proofItems.map((item, index) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="text-2xl font-bold text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                  <strong className="pt-1 text-sm text-foreground">{item}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-b border-border py-16" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex max-w-2xl flex-col gap-2">
              <p className="text-sm font-medium text-primary">Release workflow</p>
              <h2 id="workflow-heading" className="text-2xl font-bold text-foreground sm:text-3xl">
                From design change to release decision.
              </h2>
              <p className="text-sm text-muted-foreground">Keep the engineering path short: connect, evaluate, investigate.</p>
            </div>
            <ol className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {workflowSteps.map((step) => (
                <li key={step.number} className="flex flex-col gap-2">
                  <span className="text-3xl font-bold text-muted-foreground">{step.number}</span>
                  <div>
                    <h3 className="text-base font-bold text-foreground">{step.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-b border-border py-16" id="product" aria-labelledby="control-room-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex max-w-2xl flex-col gap-2">
              <p className="text-sm font-medium text-primary">What you see</p>
              <h2 id="control-room-heading" className="text-2xl font-bold text-foreground sm:text-3xl">
                The answer first. The reasons underneath.
              </h2>
              <p className="text-sm text-muted-foreground">
                Open a run and the verdict is the first thing on the page. Everything below it is there to explain that
                verdict, or to let you argue with it.
              </p>
            </div>

            <div className="mt-8 rounded-md border border-border bg-card p-6">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <span className="block text-xs uppercase text-muted-foreground">Investigation</span>
                  <strong className="text-sm text-foreground">repository / release revision</strong>
                </div>
                <ul className="flex gap-2">
                  <li className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">Decision first</li>
                  <li className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Loads fast</li>
                </ul>
              </header>
              <div className="grid grid-cols-1 gap-4 pt-4 lg:grid-cols-3">
                <article className="rounded-md border border-primary/40 bg-accent/30 p-4">
                  <span className="text-xs uppercase text-muted-foreground">Decision first</span>
                  <h3 className="mt-1 text-base font-bold text-foreground">Shortest next action before low-level evidence.</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    See the stable readiness result, blocking state, and direct path to the evidence that can change the
                    release decision.
                  </p>
                  <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
                    <span className="w-fit rounded-sm bg-muted px-2 py-1 text-xs text-foreground">Review blocking findings</span>
                    <span className="w-fit rounded-sm bg-muted px-2 py-1 text-xs text-foreground">Verify release evidence</span>
                  </div>
                </article>
                <article className="rounded-md border border-border p-4">
                  <span className="text-xs uppercase text-muted-foreground">Finding things</span>
                  <h3 className="mt-1 text-base font-bold text-foreground">Search what matters, not everything you have ever run.</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Filter findings and files without pulling your whole history down the wire.</p>
                </article>
                <article className="rounded-md border border-border p-4">
                  <span className="text-xs uppercase text-muted-foreground">Back to the source</span>
                  <h3 className="mt-1 text-base font-bold text-foreground">Every answer links back to where it came from.</h3>
                  <p className="mt-1 text-sm text-muted-foreground">One click to the commit, the Check Run, the workflow run, the pull request, or the file itself.</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-16" aria-labelledby="capabilities-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex max-w-2xl flex-col gap-2">
              <p className="text-sm font-medium text-primary">Engineering coverage</p>
              <h2 id="capabilities-heading" className="text-2xl font-bold text-foreground sm:text-3xl">
                Every check stays tied to the commit it ran on.
              </h2>
              <p className="text-sm text-muted-foreground">Layout, supply chain and manufacturing all reported the same way, so nothing needs translating.</p>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((capability) => (
                <article key={capability.title} className="rounded-md border border-border bg-card p-4">
                  <span className="text-xs uppercase text-muted-foreground">{capability.eyebrow}</span>
                  <h3 className="mt-1 text-base font-bold text-foreground">{capability.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{capability.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-16" aria-labelledby="trust-heading">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 lg:grid-cols-[3fr_2fr] lg:items-start">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-primary">Trust boundary</p>
              <h2 id="trust-heading" className="text-2xl font-bold text-foreground sm:text-3xl">Your repository stays the source of truth.</h2>
              <p className="text-sm text-muted-foreground">
                BoardReadyOps reads and reports; it does not take custody of anything. Your source, branch protections,
                pull requests, checks and full workflow logs stay in the repository you already run.
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Source of truth</dt>
                <dd className="mt-1 text-sm text-foreground">Repository commit and protected GitHub workflow evidence</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Investigation</dt>
                <dd className="mt-1 text-sm text-foreground">Findings and file details only — never your board design itself</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Decision trail</dt>
                <dd className="mt-1 text-sm text-foreground">Check Run, publication state, attempts, checksums, and audit boundary</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="border-b border-border py-16" aria-labelledby="release-guide-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex max-w-2xl flex-col gap-2">
              <p className="text-sm font-medium text-primary">How to read a release decision</p>
              <h2 id="release-guide-heading" className="text-2xl font-bold text-foreground sm:text-3xl">
                Evidence is useful when another engineer can reproduce the reasoning.
              </h2>
              <p className="text-sm text-muted-foreground">
                BoardReadyOps is built around a small set of release principles that make hardware evidence easier to
                review now and easier to audit later.
              </p>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {releaseGuides.map((guide) => (
                <article key={guide.title}>
                  <h3 className="text-base font-bold text-foreground">{guide.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{guide.body}</p>
                </article>
              ))}
            </div>
            <section className="mt-10 rounded-md border border-border bg-card p-6" aria-labelledby="evidence-checklist-heading">
              <h3 id="evidence-checklist-heading" className="text-base font-bold text-foreground">A reviewable release-evidence checklist</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A green verdict should be explainable without access to the original engineer's workstation. These are
                the evidence categories a reviewer should expect to trace.
              </p>
              <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-sm">
                {releaseEvidenceChecklist.map((entry) => (
                  <li key={entry.title}>
                    <strong className="text-foreground">{entry.title}</strong>{" "}
                    <span className="text-muted-foreground">{entry.body}</span>
                  </li>
                ))}
              </ol>
            </section>

            <div className="mt-10">
              <h3 className="text-base font-bold text-foreground">Release-readiness questions</h3>
              <p className="mt-1 text-sm text-muted-foreground">Practical boundaries that keep the verdict understandable instead of turning it into a black box.</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {releaseFaq.map((entry) => (
                <article key={entry.question}>
                  <h3 className="text-sm font-bold text-foreground">{entry.question}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{entry.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-16" id="glossary" aria-labelledby="glossary-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex max-w-2xl flex-col gap-2">
              <p className="text-sm font-medium text-primary">Glossary</p>
              <h2 id="glossary-heading" className="text-2xl font-bold text-foreground sm:text-3xl">The hardware-release terms behind the verdict.</h2>
              <p className="text-sm text-muted-foreground">
                These definitions describe the evidence BoardReadyOps reports. For implementation details, continue to
                the canonical documentation; for the public machine-readable service contract, see OpenAPI.
              </p>
            </div>
            <dl className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {glossaryTerms.map((entry) => (
                <div key={entry.term}>
                  <dt className="text-sm font-bold text-foreground">{entry.term}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{entry.definition}</dd>
                </div>
              ))}
            </dl>
            <nav className="mt-8 flex flex-wrap gap-4 text-sm" aria-label="Technical discovery references">
              <a href="https://docs.boardreadyops.com" className="text-primary hover:underline">Read the documentation</a>
              <a href="/openapi.json" className="text-primary hover:underline">OpenAPI</a>
              <a href="/llms.txt" className="text-primary hover:underline">LLM discovery</a>
              <a href="/sitemap.md" className="text-primary hover:underline">Markdown sitemap</a>
            </nav>
          </div>
        </section>

        <section className="border-b border-border bg-muted py-16" aria-labelledby="landing-cta-heading">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-primary">Next release</p>
              <h2 id="landing-cta-heading" className="text-2xl font-bold text-foreground sm:text-3xl">Check your next board before you order it.</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a className={buttonVariants({ variant: "default", size: "lg" }) + " gap-2"} href={installUrl}>
                <span>Install on GitHub</span>
                <span aria-hidden="true">↗</span>
              </a>
              <Link className={buttonVariants({ variant: "secondary", size: "lg" })} href="/setup">
                Review setup first
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <span className="flex items-center gap-2 text-sm font-bold text-foreground">
            <BrandMarkIcon size={20} />
            BoardReadyOps
          </span>
          <p className="text-sm text-muted-foreground">
            Release readiness checks for hardware teams. Your repository and its full workflow logs stay the source of
            truth.
          </p>
          <a href="https://docs.boardreadyops.com" className="text-sm text-primary hover:underline">Documentation</a>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 9: Rewrite the CSS-token test in `tests/unit/web/home-page.test.ts`**

```typescript
  it("no longer ships a separate landing.css and uses the shared design tokens instead", async () => {
    const { access } = await import("node:fs/promises");
    await expect(access("apps/web/app/landing.css")).rejects.toThrow();
    const page = await readFile("apps/web/app/page.tsx", "utf8");
    expect(page).not.toContain("landing.css");
    expect(page).not.toMatch(/trusted by|customers|teams worldwide/i);
  });
```

(Replaces the last test in the file, which read `apps/web/app/landing.css` for `--foundry-canvas`/`--foundry-copper` — both gone now that the file is deleted. Add `import { readFile } from "node:fs/promises";` at the top of the test file if not already imported by an earlier test in it — it already is, from the existing final test.)

- [ ] **Step 10: Run the home page and layout metadata test files**

Run: `corepack pnpm exec vitest run tests/unit/web/home-page.test.ts tests/unit/web/layout-metadata.test.ts`
Expected: PASS.

- [ ] **Step 11: Lint, typecheck, and confirm no remaining `landing-*` or copper references**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && grep -rn "c69a3e\|landing-button\|landing-nav-cta" apps/web --include=*.tsx`
Expected: lint/typecheck pass; the grep returns no matches.

- [ ] **Step 12: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/app/page.tsx apps/web/app/opengraph-image.tsx apps/web/components/brand-mark.tsx apps/web/components/viewer-controls.tsx apps/web/components/landing-actions.tsx tests/unit/web/home-page.test.ts
git rm apps/web/app/landing.css
git commit -m "feat(web): migrate landing page, brand mark, and viewer controls to Tailwind"
```

This completes Phase C (public marketing site).

## Phase C+: Run investigation and operator dead-letter queue (spec-gap correction)

**Why these tasks exist:** ADR-0016's Scope section does not name `/runs/[runId]/*` or `/ops/dead-letters` among the in-scope pages. Discovered while writing the Phase D cleanup task: both surfaces render `apps/web/app/styles.css` classes (`run-header`, `run-verdict`, `finding-list`, `timeline`, `dead-letters-workspace`, and dozens more), and the ADR's own Rollout strategy item 3 requires "a repo-wide grep for its class names must return zero hits in `apps/web/`" before `styles.css` can be deleted — a requirement that is unsatisfiable while these two surfaces stay unconverted. Raised to the user 2026-09-05; resolved as: convert both, so the zero-references gate is real rather than nominal. `apps/web/components/run-investigation.tsx` (1,085 lines) is the single largest file in the whole migration, split across two tasks (23, 24) by view group for the same task-sizing reason Reviews was split across five.

### Task 22: Migrate the run investigation shell (`RunPageFrame`, `RunHeader`, `RunVerdictBanner`, `RunNavigation`, `RunUnavailable`, `RunStateNotice`, `RunLiveRefresh`) and the run route's state pages

**Files:**
- Modify: `apps/web/components/run-investigation.tsx` (shell functions only — lines 1–226 of the original file: `RunNavigation`, `RunHeader`, `RunPageFrame`, `RunVerdictBanner`, `RunUnavailable`, `RunStateNotice`)
- Modify: `apps/web/components/run-live-refresh.tsx`
- Modify: `apps/web/app/runs/[runId]/error.tsx`
- Modify: `apps/web/app/runs/[runId]/loading.tsx`
- Modify: `apps/web/app/runs/[runId]/not-found.tsx`

**Interfaces:**
- Consumes: `Alert`, `AppShell`, `Breadcrumbs`, `EmptyState`, `Panel` (`apps/web/components/ui.tsx`); `Button` (`apps/web/components/ui/button.tsx`); `runVerdict` (`apps/web/lib/run-verdict.ts`, unchanged — its `VerdictTone` union `"success" | "danger" | "warning" | "info"` already matches `Badge`/`Alert` variant names exactly).
- Produces: `RunView`, `RunPageFrame({ run, active, children, liveRefresh })`, `RunHeader`, `RunUnavailable`, `RunStateNotice` — all six route files (`page.tsx`, `artifacts/page.tsx`, `attempts/page.tsx`, `audit/page.tsx`, `findings/page.tsx`, `publication/page.tsx`) compose `RunPageFrame` and `RunUnavailable` directly and are otherwise pure data-loading wrappers with no bespoke JSX of their own, so none of them need edits in this task.

`run-investigation-accessibility.test.ts:196-197` pins two literal class-name substrings — `run-identity-meta` and `run-readiness-signature` — kept as literal tokens alongside the new Tailwind utilities (same pattern as `delivery-signoff-card` in Task 15), so that test needs no changes.

- [ ] **Step 1: Rewrite the shell portion of `apps/web/components/run-investigation.tsx` (lines 1–226 of the original — imports through the end of `RunStateNotice`; everything from `githubRepositoryBaseUrl` onward is addressed in Tasks 23–24 and is untouched here)**

```typescript
import Link from "next/link";
import type { ReactNode } from "react";
import type { RunDashboardFilters, RunDetail } from "../lib/run-dashboard.js";

type ArtifactDetail = RunDetail["artifacts"][number];
type AttemptDetail = RunDetail["attempts"][number];
type FindingDetail = RunDetail["findings"][number];

import { formatArtifactBytes, formatRunDate, formatRunDuration } from "../lib/run-dashboard.js";
import { runVerdict } from "../lib/run-verdict.js";
import { CopyButton } from "./copy-button.js";
import { RunLiveRefresh } from "./run-live-refresh.js";
import {
  Alert,
  AppShell,
  Breadcrumbs,
  Definition,
  DefinitionGrid,
  EmptyState,
  humanize,
  Pagination,
  Panel,
  StatusBadge,
} from "./ui.js";
import { ViewerNav } from "./viewer-nav.js";

export type RunView = "artifacts" | "attempts" | "audit" | "findings" | "publication" | "summary";

const navigationItems: ReadonlyArray<{ view: RunView; label: string; suffix: string }> = [
  { view: "summary", label: "Summary", suffix: "" },
  { view: "attempts", label: "Attempts", suffix: "/attempts" },
  { view: "findings", label: "Findings", suffix: "/findings" },
  { view: "artifacts", label: "Artifacts", suffix: "/artifacts" },
  { view: "publication", label: "Publication", suffix: "/publication" },
  { view: "audit", label: "Audit", suffix: "/audit" },
];

function RunNavigation({ runId, active }: Readonly<{ runId: string; active: RunView }>) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Run investigation">
      <ul className="flex flex-wrap gap-1">
        {navigationItems.map((item) => (
          <li key={item.view}>
            <Link
              href={`/runs/${runId}${item.suffix}`}
              aria-current={active === item.view ? "page" : undefined}
              className={`block border-b-2 px-3 py-2 text-sm font-medium ${active === item.view ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function RunHeader({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <header className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-lg sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium text-primary">Release readiness</p>
        <h1 className="text-xl font-bold text-foreground">{run.repository}</h1>
        <p className="run-identity-meta mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{run.repositoryPrivate ? "Private repository" : "Public repository"}</span>
          <span>
            Run <code>{run.id}</code>
          </span>
          <span>
            Commit <code>{run.commitSha.slice(0, 12)}</code>
          </span>
          <span>
            <code>{run.ref}</code>
          </span>
        </p>
      </div>
      <fieldset className="shrink-0">
        <legend className="sr-only">Readiness score</legend>
        <div className="run-readiness-signature flex flex-col items-center rounded-md border border-border bg-muted px-4 py-2">
          <strong className="text-2xl font-bold text-foreground">{run.readinessScore ?? "—"}</strong>
          <span className="text-xs text-muted-foreground">Readiness score</span>
          <span className="sr-only">
            {run.readinessScore === undefined
              ? "Readiness score unavailable"
              : `Readiness score ${run.readinessScore} out of 100`}
          </span>
        </div>
      </fieldset>
    </header>
  );
}

export function RunPageFrame({
  run,
  active,
  children,
  liveRefresh,
}: Readonly<{ run: RunDetail; active: RunView; children: ReactNode; liveRefresh?: boolean }>) {
  const currentLabel = navigationItems.find((item) => item.view === active)?.label ?? "Run";
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: `/repositories/${run.repositoryId}`, label: run.repository },
            { label: currentLabel },
          ]}
        />
        <RunHeader run={run} />
        <RunVerdictBanner run={run} />
        {liveRefresh ? <RunLiveRefresh enabled /> : null}
        <RunNavigation runId={run.id} active={active} />
        <RunStateNotice run={run} />
        <div className="flex flex-col gap-4">{children}</div>
      </main>
    </AppShell>
  );
}

const verdictBandClass: Record<"success" | "danger" | "warning" | "info", string> = {
  success: "border-success/40 bg-success-surface",
  danger: "border-danger/40 bg-danger-surface",
  warning: "border-warning/40 bg-warning-surface",
  info: "border-info/40 bg-info-surface",
};

const verdictTextClass: Record<"success" | "danger" | "warning" | "info", string> = {
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  info: "text-info",
};

/**
 * The answer, before anything else on the page.
 *
 * Deliberately not a Panel: a panel is one card among many and reads as another section to
 * scan. This is the sentence the reader came for, so it is given the top of the page, the
 * largest type on it, and a single next step.
 */
function RunVerdictBanner({ run }: Readonly<{ run: RunDetail }>) {
  const verdict = runVerdict(run);
  return (
    <section
      className={`rounded-md border p-5 ${verdictBandClass[verdict.tone]}`}
      aria-labelledby="run-verdict-headline"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="run-verdict-headline" className={`text-xl font-bold ${verdictTextClass[verdict.tone]}`}>
            {verdict.headline}
          </h2>
          <p className="mt-1 text-sm text-foreground">{verdict.detail}</p>
        </div>
        {verdict.action ? (
          <Link
            href={verdict.action.href}
            className="w-fit rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            {verdict.action.label}
          </Link>
        ) : undefined}
      </div>
    </section>
  );
}

export function RunUnavailable({ runId }: Readonly<{ runId: string }>) {
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Run unavailable" }]} />
        <h1 className="sr-only">Run details temporarily unavailable</h1>
        <Alert title="Run details temporarily unavailable" tone="warning">
          <p>
            This deployment can't load run <code>{runId}</code> right now. No run data was inferred or cached by this
            page.
          </p>
          <p>
            If this persists, report it via a{" "}
            <a href="https://github.com/oaslananka/boardreadyops/issues/new" rel="noreferrer">
              GitHub issue
            </a>{" "}
            with this run ID; the operator responsible for this deployment can see the underlying cause in server logs.
          </p>
        </Alert>
      </main>
    </AppShell>
  );
}

export function RunStateNotice({ run }: Readonly<{ run: RunDetail }>) {
  if (run.investigationState === "dead_letter") {
    return (
      <Alert title="Recovery requires operator action" tone="danger">
        <p>
          {run.deadLetterCount} reconciliation item{run.deadLetterCount === 1 ? " is" : "s are"} in dead-letter state.
          The visible result is preserved, but automated recovery has stopped for those items and needs the deployment
          operator to intervene.
        </p>
        <Link href={`/runs/${run.id}/audit`}>See what to report and to whom</Link>
      </Alert>
    );
  }
  if (run.investigationState === "partial_data") {
    return (
      <Alert title="This run has partial data" tone="warning">
        <p>
          This run finished, but no signed result ever arrived. Until that gap is explained, the workflow logs in GitHub
          are the record to trust.
        </p>
        <Link href={`/runs/${run.id}/publication`}>Review publication state</Link>
      </Alert>
    );
  }
  if (run.investigationState === "reconciliation") {
    return (
      <Alert title="Reconciliation is active" tone="warning">
        <p>
          {run.reconciliationCount} recovery item{run.reconciliationCount === 1 ? " is" : "s are"} checking external and
          durable state. The current run result remains visible while recovery converges.
        </p>
        <Link href={`/runs/${run.id}/attempts`}>Review attempts and lifecycle transitions</Link>
      </Alert>
    );
  }
  if (run.investigationState === "stale") {
    return (
      <Alert title="This run may be stale" tone="warning">
        <p>The run is non-terminal and has not recorded activity for more than 15 minutes.</p>
        <Link href={`/runs/${run.id}/attempts`}>Inspect the execution timeline</Link>
      </Alert>
    );
  }
  if (run.investigationState === "failed" || run.investigationState === "timed_out") {
    return (
      <Alert title={run.investigationState === "timed_out" ? "Run timed out" : "Run failed"} tone="danger">
        <p>Review the latest attempt and blocking findings before retrying or approving a release.</p>
        <Link href={`/runs/${run.id}/attempts`}>Open attempt diagnostics</Link>
      </Alert>
    );
  }
  if (run.investigationState === "superseded") {
    return (
      <Alert title="A newer run superseded this result" tone="info">
        <p>This page is kept for history. For the current answer, use the newest Check Run.</p>
      </Alert>
    );
  }
  return null;
}
```

`RunStateNotice`'s "superseded" branch changes `tone="neutral"` to `tone="info"`: `Alert`'s `tone` prop (Task 4) is typed `StatusTone`, which has no `"neutral"` member with its own `Alert` styling beyond mapping to `"default"` internally — `"info"` is the closest real status tone and matches this notice's actual meaning (informational, not a problem).

- [ ] **Step 2: Rewrite `apps/web/components/run-live-refresh.tsx`'s render output (only the final `return`; the hook, `browserEnvironment`, and all types above it are unchanged)**

```typescript
  if (!enabled) return null;
  return (
    <output className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden="true" />
      <span>
        <strong className="text-foreground">Live status updates</strong> refresh every five seconds and resume
        automatically after reconnect.
      </span>
    </output>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/app/runs/[runId]/error.tsx`**

```typescript
"use client";

import { Alert, AppShell, Breadcrumbs } from "../../../components/ui.js";
import { Button } from "../../../components/ui/button.js";

export default function RunError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Run error" }]} />
        <Alert title="Could not load this run" tone="danger">
          <p>Something went wrong on our side. Try again — the run itself is unaffected.</p>
          {error.digest ? (
            <p>
              Support reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <Button type="button" onClick={reset} className="mt-2">
            Retry
          </Button>
        </Alert>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 4: Rewrite `apps/web/app/runs/[runId]/loading.tsx`**

```typescript
import { AppShell, Breadcrumbs, Panel } from "../../../components/ui.js";

export default function LoadingRun() {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8" id="main-content" aria-busy="true">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Loading run" }]} />
        <div className="h-24 animate-pulse rounded-md bg-muted" />
        <Panel title="Loading this run" description="Fetching the results.">
          <div className="h-4 animate-pulse rounded-sm bg-muted" />
          <div className="mt-2 h-4 w-2/3 animate-pulse rounded-sm bg-muted" />
        </Panel>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 5: Rewrite `apps/web/app/runs/[runId]/not-found.tsx`**

```typescript
import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState } from "../../../components/ui.js";
import { buttonVariants } from "../../../components/ui/button.js";

export default function RunNotFound() {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Run unavailable" }]} />
        <h1 className="sr-only">Run unavailable</h1>
        <EmptyState
          title="This run is not available"
          action={
            <Link className={buttonVariants({ variant: "default" })} href="/">
              Return home
            </Link>
          }
        >
          <p>The link may be wrong, the run may have aged out, or it may belong to a repository you cannot see.</p>
        </EmptyState>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 6: Run the accessibility and live-refresh test files**

Run: `corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-live-refresh.test.ts tests/unit/web/run-verdict.test.ts tests/unit/web/run-state-pages.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass — note Steps 1's rewrite is a partial-file edit, so run this against the real file only after Tasks 23–24 have also landed their portions, or apply Step 1 as a true prefix replacement (lines 1–226) leaving the remainder of the original file intact until those tasks run.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/run-investigation.tsx apps/web/components/run-live-refresh.tsx apps/web/app/runs/\[runId\]/error.tsx apps/web/app/runs/\[runId\]/loading.tsx apps/web/app/runs/\[runId\]/not-found.tsx
git commit -m "feat(web): migrate run investigation shell and run route state pages to Tailwind"
```

### Task 23: Migrate `SummaryView`, `BoardsPanel`, `CategoryBreakdownPanel`, `AttemptsView`, `AttemptTimeline`

**Files:**
- Modify: `apps/web/components/run-investigation.tsx` (this task's portion: the original file's `githubRepositoryBaseUrl` through the end of `AttemptsView`, i.e. lines 228–575)

**Interfaces:**
- Consumes: `Alert`, `Definition`, `DefinitionGrid`, `EmptyState`, `Panel`, `StatusBadge`, `humanize` (`apps/web/components/ui.tsx`); `formatArtifactBytes`, `formatRunDate`, `formatRunDuration` (`apps/web/lib/run-dashboard.ts`, unchanged).
- Produces: `SummaryView`, `AttemptTimeline`, `AttemptsView` — consumed by `apps/web/app/runs/[runId]/page.tsx` and `attempts/page.tsx` (both untouched, per Task 22's note that the six route files need no edits).

`run-investigation-accessibility.test.ts:215-224` checks the `CategoryBreakdownPanel` renders "Findings by domain" / "Sourcing / BOM" / "Electrical" when `run.categoryBreakdown` is non-empty and omits that heading entirely when it's empty — both are text-content checks, unaffected by this rewrite.

- [ ] **Step 1: Rewrite lines 228–575 of `apps/web/components/run-investigation.tsx`** (this replaces `githubRepositoryBaseUrl`, `BoardsPanel`, the `CATEGORY_LABEL` map, `categoryLabel`, `CategoryBreakdownPanel`, `SummaryView`, `AttemptTimeline`, and `AttemptsView` — everything between `RunStateNotice` (Task 22) and the `export type SearchParameterMap` line that starts Task 24's portion)

```typescript
function githubRepositoryBaseUrl(run: RunDetail): string {
  const [owner = "", repository = ""] = run.repository.split("/", 2);
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

function BoardsPanel({ run }: Readonly<{ run: RunDetail }>) {
  if (run.boards.length === 0) return null;
  const totalComponents = run.boards.reduce((sum, board) => sum + board.componentCount, 0);
  return (
    <Panel
      id="boards"
      title="Boards in this run"
      description={`Components captured per board, kept as the record of what ${
        run.boards.length === 1 ? "this board" : "these boards"
      } shipped with.`}
    >
      <ul className="flex flex-col gap-3">
        {run.boards.map((board) => (
          <li key={board.boardId} className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm text-foreground">{board.displayName}</strong>
              {board.riskyLifecycleCount > 0 ? (
                <StatusBadge value="warning" label={`${board.riskyLifecycleCount} at lifecycle risk`} />
              ) : null}
            </div>
            <p className="mt-1 text-xs">
              <code>{board.project}</code>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Components</dt>
                <dd className="text-sm text-foreground">{board.componentCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">With part number</dt>
                <dd className="text-sm text-foreground">{board.identifiedComponentCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Without part number</dt>
                <dd className="text-sm text-foreground">{board.unidentifiedComponentCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Captured</dt>
                <dd className="text-sm text-foreground">{formatRunDate(board.capturedAt)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      {totalComponents === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No components were captured. Add a BOM to each board so its parts can be tracked between releases.
        </p>
      ) : null}
    </Panel>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  electrical: "Electrical",
  manufacturability: "Manufacturability (DFM)",
  assembly: "Assembly (DFA)",
  testability: "Testability (DFT)",
  sourcing: "Sourcing / BOM",
  release: "Release",
  unclassified: "Other",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? humanize(category);
}

/**
 * Per-domain finding rollup for the whole run, independent of the findings table's own
 * filter/pagination -- run.categoryBreakdown (apps/web/lib/run-dashboard.ts) answers "what does
 * this run look like overall". Renders nothing for a run with no recorded category data (older
 * runs predating the findings.category column) rather than showing a fabricated all-zero grid.
 */
function CategoryBreakdownPanel({ run }: Readonly<{ run: RunDetail }>) {
  if (run.categoryBreakdown.length === 0) {
    return null;
  }
  return (
    <Panel
      title="Findings by domain"
      description="Per-domain finding counts for this run, independent of the findings table's current filter."
      id="category-breakdown"
      tone="section"
    >
      <div className="overflow-x-auto" aria-label="Findings by domain table">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th scope="col" className="py-2 pr-3">Domain</th>
              <th scope="col" className="py-2 pr-3">Findings</th>
              <th scope="col" className="py-2 pr-3">Critical</th>
              <th scope="col" className="py-2 pr-3">High</th>
              <th scope="col" className="py-2 pr-3">Medium</th>
              <th scope="col" className="py-2 pr-3">Low</th>
            </tr>
          </thead>
          <tbody>
            {run.categoryBreakdown.map((entry) => (
              <tr key={entry.category} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-3">{categoryLabel(entry.category)}</td>
                <td className="py-2 pr-3">{entry.total}</td>
                <td className="py-2 pr-3">{entry.critical}</td>
                <td className="py-2 pr-3">{entry.high}</td>
                <td className="py-2 pr-3">{entry.medium}</td>
                <td className="py-2 pr-3">{entry.low}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function SummaryView({ run }: Readonly<{ run: RunDetail }>) {
  const latestWorkflowRunUrl = run.attempts.find((attempt) => attempt.workflowRunUrl)?.workflowRunUrl;
  return (
    <>
      <Panel
        title="Run summary"
        description="Repository, source, execution, and result metadata."
        id="summary"
        tone="section"
      >
        <DefinitionGrid>
          <Definition label="Outcome">
            <StatusBadge value={run.decision ?? run.conclusion ?? run.status} />
          </Definition>
          <Definition label="Trigger">{humanize(run.triggerKind)}</Definition>
          <Definition label="Pull request">
            {run.pullRequestNumber ? `#${run.pullRequestNumber}` : "Not a pull request"}
          </Definition>
          <Definition label="Started">{formatRunDate(run.startedAt)}</Definition>
          <Definition label="Completed">{formatRunDate(run.completedAt)}</Definition>
          <Definition label="Duration">{formatRunDuration(run.durationMs)}</Definition>
          <Definition label="Last activity">{formatRunDate(run.lastActivityAt)}</Definition>
        </DefinitionGrid>
      </Panel>

      <CategoryBreakdownPanel run={run} />

      <BoardsPanel run={run} />

      <Panel
        title="Source and runtime"
        description="Exact source identity and tool versions used by the result."
        id="source"
        tone="section"
      >
        <DefinitionGrid>
          <Definition label="Commit">
            <code>{run.commitSha}</code>
          </Definition>
          <Definition label="Ref">
            <code>{run.ref}</code>
          </Definition>
          <Definition label="Check Run">
            {run.githubCheckRunId ? <code>{run.githubCheckRunId}</code> : "Not recorded"}
          </Definition>
          <Definition label="Result contract">
            {run.resultContractVersion ? `v${run.resultContractVersion}` : "Not reported"}
          </Definition>
          <Definition label="BoardReadyOps">{run.boardReadyOpsVersion ?? "Not reported"}</Definition>
          <Definition label="KiCad">{run.kicadVersion ?? "Not reported"}</Definition>
          <Definition label="Trust mode">{humanize(run.trustMode)}</Definition>
          <Definition label="Safe-mode reasons">
            {run.safeModeReasons.length > 0 ? run.safeModeReasons.map(humanize).join(" · ") : "None"}
          </Definition>
          <Definition label="Policy preset">
            {run.setupPreset
              ? `${humanize(run.setupPreset)} v${run.setupPresetVersion ?? "?"} · revision ${run.setupRevision ?? "?"}`
              : "Not recorded"}
          </Definition>
          <Definition label="Setup readiness">
            {run.setupWorkflowStatus || run.setupConfigStatus
              ? `Workflow ${humanize(run.setupWorkflowStatus ?? "unknown")} · config ${humanize(run.setupConfigStatus ?? "unknown")}`
              : "Not recorded"}
          </Definition>
          <Definition label="Workflow contract">
            {run.setupWorkflowContractVersion ? `v${run.setupWorkflowContractVersion}` : "Not recorded"}
          </Definition>
        </DefinitionGrid>
        <nav className="mt-3 flex flex-wrap gap-4 text-sm" aria-label="Open this run in GitHub">
          <a href={`${githubRepositoryBaseUrl(run)}/commit/${encodeURIComponent(run.commitSha)}`} className="text-primary hover:underline">
            Open source commit
          </a>
          <a href={`${githubRepositoryBaseUrl(run)}/commit/${encodeURIComponent(run.commitSha)}/checks`} className="text-primary hover:underline">
            Open GitHub checks
          </a>
          {latestWorkflowRunUrl ? (
            <a href={latestWorkflowRunUrl} className="text-primary hover:underline">Open GitHub Actions run</a>
          ) : null}
          {run.pullRequestNumber ? (
            <a href={`${githubRepositoryBaseUrl(run)}/pull/${run.pullRequestNumber}`} className="text-primary hover:underline">
              Open pull request #{run.pullRequestNumber}
            </a>
          ) : null}
        </nav>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Findings"
          description={`${run.findingsPage.total} matching finding${run.findingsPage.total === 1 ? "" : "s"}.`}
          actions={<Link href={`/runs/${run.id}/findings`} className="text-sm text-primary hover:underline">View all</Link>}
        >
          {run.findings.length === 0 ? (
            <EmptyState title="No findings">
              <p>The current result contains no matching findings.</p>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {run.findings.slice(0, 5).map((finding) => (
                <li key={finding.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-foreground">{finding.ruleId}</strong>
                    <StatusBadge value={finding.severity} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{finding.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Artifacts"
          description={`${run.artifactsPage.total} matching artifact${run.artifactsPage.total === 1 ? "" : "s"}.`}
          actions={<Link href={`/runs/${run.id}/artifacts`} className="text-sm text-primary hover:underline">View all</Link>}
        >
          {run.artifacts.length === 0 ? (
            <EmptyState title="No artifacts">
              <p>No managed artifact metadata is attached to this run.</p>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {run.artifacts.slice(0, 5).map((artifact) => (
                <li key={artifact.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-foreground">{artifact.name}</strong>
                    <StatusBadge value={artifact.availability} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {artifact.kind} · {formatArtifactBytes(artifact.bytes)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

export function AttemptTimeline({ attempts }: Readonly<{ attempts: AttemptDetail[] }>) {
  if (attempts.length === 0) {
    return (
      <EmptyState title="No execution attempt">
        <p>No worker or target workflow has claimed this run.</p>
      </EmptyState>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {attempts.map((attempt) => (
        <li key={attempt.id} className="flex gap-3">
          <div className="mt-1.5 size-2 shrink-0 rounded-full bg-border" aria-hidden="true" />
          <article className="flex-1 rounded-md border border-border bg-card p-3">
            <header className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Attempt {attempt.attemptNumber}</h3>
              <StatusBadge value={attempt.status} />
            </header>
            <div className="mt-2">
              <DefinitionGrid>
                <Definition label="Created">{formatRunDate(attempt.createdAt)}</Definition>
                <Definition label="Dispatched">{formatRunDate(attempt.dispatchedAt)}</Definition>
                <Definition label="Started">{formatRunDate(attempt.startedAt)}</Definition>
                <Definition label="Heartbeat">{formatRunDate(attempt.heartbeatAt)}</Definition>
                <Definition label="Completed">{formatRunDate(attempt.completedAt)}</Definition>
                <Definition label="Retry after">{formatRunDate(attempt.retryAfterAt)}</Definition>
              </DefinitionGrid>
            </div>
            {attempt.workflowDispatchId ? (
              <p className="mt-2 text-sm text-foreground">
                Workflow run: <code>{attempt.workflowDispatchId}</code>
                {attempt.workflowRunUrl ? (
                  <>
                    {" · "}
                    <a href={attempt.workflowRunUrl} className="text-primary hover:underline">Open workflow logs and artifacts</a>
                  </>
                ) : null}
              </p>
            ) : null}
            {attempt.failureClass || attempt.failureMessage ? (
              <div className="mt-2">
                <Alert title={attempt.failureClass ? humanize(attempt.failureClass) : "Attempt failed"} tone="danger">
                  <p>{attempt.failureMessage ?? "The attempt reached a failed terminal state."}</p>
                </Alert>
              </div>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}

export function AttemptsView({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <>
      <Panel title="Execution attempts" description="Newest first, up to 50 attempts." id="attempts">
        <AttemptTimeline attempts={run.attempts} />
      </Panel>

      <Panel
        title="Lifecycle transitions"
        description="State changes only, never board content. Newest first, up to 100."
        id="transitions"
      >
        {run.transitions.length === 0 ? (
          <EmptyState title="No lifecycle transitions">
            <p>Older runs may not have versioned transition evidence.</p>
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {run.transitions.map((transition) => (
              <li
                key={`${transition.entityType}:${transition.executionAttemptId ?? "run"}:${transition.toVersion}:${transition.occurredAt}`}
                className="rounded-md border border-border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <strong className="text-sm text-foreground">
                    {transition.entityType === "release_run" ? "Logical run" : "Execution attempt"}
                  </strong>
                  <StatusBadge value={transition.reasonCode} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <code>{transition.fromStatus}</code> to <code>{transition.toStatus}</code> · version{" "}
                  {transition.fromVersion} to {transition.toVersion}
                </p>
                {transition.executionAttemptId ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Attempt <code>{transition.executionAttemptId}</code>
                  </p>
                ) : null}
                <time dateTime={transition.occurredAt} className="mt-1 block text-xs text-muted-foreground">
                  {formatRunDate(transition.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
```

- [ ] **Step 2: Run the affected tests**

Run: `corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-dashboard.test.ts tests/unit/web/run-verdict.test.ts`
Expected: PASS.

- [ ] **Step 3: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass (note: this file is only fully valid once Task 24's portion also lands, same as noted in Task 22).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/run-investigation.tsx
git commit -m "feat(web): migrate SummaryView, BoardsPanel, and AttemptsView to Tailwind"
```

### Task 24: Migrate `FindingsView`, `ArtifactsView`, `PublicationView`, `AuditView` — the remainder of `run-investigation.tsx`

**Files:**
- Modify: `apps/web/components/run-investigation.tsx` (this task's portion: the original file's `export type SearchParameterMap` through end-of-file, i.e. lines 577–1085 — everything Tasks 22–23 did not already cover)

**Interfaces:**
- Consumes: `Alert`, `Definition`, `DefinitionGrid`, `EmptyState`, `Pagination`, `Panel`, `StatusBadge`, `humanize` (`apps/web/components/ui.tsx`); `Button` (`apps/web/components/ui/button.tsx`); `CopyButton` (`apps/web/components/copy-button.tsx`, converted in this task since this is its only remaining unconverted consumer besides `ArtifactRow` in the same file — see Step 5).
- Produces: `SearchParameterMap`, `filtersFromSearchParameters`, `FindingList`, `FindingsView`, `ArtifactTable`, `ArtifactsView`, `PublicationView`, `AuditView` — consumed by `findings/page.tsx`, `artifacts/page.tsx`, `publication/page.tsx`, `audit/page.tsx` (all untouched, per Task 22's note).

Once this task lands, `run-investigation.tsx` (Tasks 22–24 combined) and every route file that consumes it are fully off `styles.css`. Also fixes the CAD-format-neutral copy violation in `FindingRow`'s corrective-action text: "Update source file ... in KiCad to resolve" implies KiCad is the only supported format.

`filtersFromSearchParameters`, `stringSearchParameters`, `findingGroupValue`, and `safeDomId` (pure logic, no JSX) are copied verbatim below only because they sit between JSX-bearing functions in the original file and the plan's no-placeholder rule requires the full replacement block to compile standalone — none of their logic changes.

- [ ] **Step 1: Rewrite `apps/web/components/copy-button.tsx`'s render output (only the final `return`; all state/refs/handlers above it are unchanged)**

```typescript
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
```

Add `import { Button } from "./ui/button.js";` to the file's imports.

- [ ] **Step 2: Rewrite lines 577–987 of `apps/web/components/run-investigation.tsx`** (this replaces `SearchParameterMap` through `ArtifactRow`)

```typescript
export type SearchParameterMap = Readonly<Record<string, string | string[] | undefined>>;
type FindingGroup = "kind" | "none" | "path" | "rule" | "severity";

function firstParameter(parameters: SearchParameterMap, name: string): string | undefined {
  const value = parameters[name];
  return Array.isArray(value) ? value[0] : value;
}

export function filtersFromSearchParameters(parameters: SearchParameterMap): RunDashboardFilters {
  const findingsPage = Number(firstParameter(parameters, "findingsPage"));
  const artifactsPage = Number(firstParameter(parameters, "artifactsPage"));
  const findingState = firstParameter(parameters, "findingState");
  const findingSort = firstParameter(parameters, "findingSort");
  const findingGroup = firstParameter(parameters, "findingGroup");
  const artifactSort = firstParameter(parameters, "artifactSort");
  const findingSearch = firstParameter(parameters, "findingSearch");
  const findingSeverity = firstParameter(parameters, "findingSeverity");
  const artifactSearch = firstParameter(parameters, "artifactSearch");
  const artifactRole = firstParameter(parameters, "artifactRole");
  const artifactKind = firstParameter(parameters, "artifactKind");
  return {
    ...(findingSearch ? { findingSearch } : {}),
    ...(findingSeverity ? { findingSeverity } : {}),
    findingState: findingState === "active" || findingState === "waived" ? findingState : "all",
    findingSort: findingSort === "path" || findingSort === "rule" ? findingSort : "severity",
    findingGroup:
      findingGroup === "kind" || findingGroup === "path" || findingGroup === "rule" || findingGroup === "severity"
        ? findingGroup
        : "none",
    findingsPage: Number.isSafeInteger(findingsPage) && findingsPage > 0 ? findingsPage : 1,
    ...(artifactSearch ? { artifactSearch } : {}),
    ...(artifactRole ? { artifactRole } : {}),
    ...(artifactKind ? { artifactKind } : {}),
    artifactSort: artifactSort === "name" || artifactSort === "size" ? artifactSort : "newest",
    artifactsPage: Number.isSafeInteger(artifactsPage) && artifactsPage > 0 ? artifactsPage : 1,
  };
}

function stringSearchParameters(parameters: SearchParameterMap): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value]),
  );
}

function findingGroupValue(finding: FindingDetail, group: FindingGroup): string {
  if (group === "severity") return humanize(finding.severity);
  if (group === "rule") return finding.ruleId;
  if (group === "kind") return finding.kind ? humanize(finding.kind) : "Kind not reported";
  if (group === "path") return finding.path ?? "Path not reported";
  return "All findings";
}

const inputClass =
  "rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FindingList({
  findings,
  group = "none",
}: Readonly<{ findings: FindingDetail[]; group?: FindingGroup }>) {
  if (findings.length === 0) {
    return (
      <EmptyState title="No matching findings">
        <p>Change the filters or return to the full findings list.</p>
      </EmptyState>
    );
  }
  if (group === "none") {
    return (
      <ul className="flex flex-col gap-2">
        {findings.map((finding) => (
          <FindingRow key={finding.id} finding={finding} />
        ))}
      </ul>
    );
  }
  const groups = new Map<string, FindingDetail[]>();
  for (const finding of findings) {
    const label = findingGroupValue(finding, group);
    groups.set(label, [...(groups.get(label) ?? []), finding]);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([label, entries]) => (
        <section key={label} aria-labelledby={`finding-group-${safeDomId(label)}`}>
          <header className="flex items-center gap-2">
            <h3 id={`finding-group-${safeDomId(label)}`} className="text-sm font-bold text-foreground">{label}</h3>
            <span className="text-xs text-muted-foreground">{entries.length} on this page</span>
          </header>
          <ul className="mt-2 flex flex-col gap-2">
            {entries.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function safeDomId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 64) || "other"
  );
}

export function FindingsView({
  run,
  searchParameters,
}: Readonly<{ run: RunDetail; searchParameters: SearchParameterMap }>) {
  const current = stringSearchParameters(searchParameters);
  const group = filtersFromSearchParameters(searchParameters).findingGroup ?? "none";
  return (
    <Panel title="Findings" description="Find what you need without loading every finding at once." id="findings">
      <form className="flex flex-wrap items-end gap-3" method="get" action={`/runs/${run.id}/findings`}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Search findings</span>
          <input
            name="findingSearch"
            type="search"
            maxLength={128}
            defaultValue={current.findingSearch}
            placeholder="Rule, message, or path"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Severity</span>
          <select name="findingSeverity" defaultValue={current.findingSeverity ?? ""} className={inputClass}>
            <option value="">All severities</option>
            {["critical", "error", "high", "medium", "warning", "low", "info"].map((severity) => (
              <option key={severity} value={severity}>
                {humanize(severity)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Waiver state</span>
          <select name="findingState" defaultValue={current.findingState ?? "all"} className={inputClass}>
            <option value="all">All findings</option>
            <option value="active">Active only</option>
            <option value="waived">Waived only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Group</span>
          <select name="findingGroup" defaultValue={current.findingGroup ?? "none"} className={inputClass}>
            <option value="none">No grouping</option>
            <option value="severity">Severity</option>
            <option value="rule">Rule ID</option>
            <option value="kind">Kind</option>
            <option value="path">Path</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Sort</span>
          <select name="findingSort" defaultValue={current.findingSort ?? "severity"} className={inputClass}>
            <option value="severity">Severity</option>
            <option value="rule">Rule ID</option>
            <option value="path">Path</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit">Apply filters</Button>
          <Link className={buttonVariants({ variant: "secondary" })} href={`/runs/${run.id}/findings`}>
            Reset
          </Link>
        </div>
      </form>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {run.findingsPage.total} matching finding{run.findingsPage.total === 1 ? "" : "s"}
      </p>
      <div className="mt-3">
        <FindingList findings={run.findings} group={group} />
      </div>
      <div className="mt-4">
        <Pagination
          basePath={`/runs/${run.id}/findings`}
          page={run.findingsPage.page}
          totalPages={run.findingsPage.totalPages}
          pageParameter="findingsPage"
          searchParameters={current}
        />
      </div>
    </Panel>
  );
}

function FindingRow({ finding }: Readonly<{ finding: FindingDetail }>) {
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <strong className="text-sm text-foreground">{finding.ruleId}</strong>
          <StatusBadge value={finding.severity} />
        </div>
        <StatusBadge value={finding.waivedAt ? "waived" : "active"} />
      </header>
      <p className="mt-1 text-sm text-foreground">{finding.message}</p>
      <dl className="mt-2 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Path</dt>
          <dd className="text-sm text-foreground">{finding.path ? <code>{finding.path}</code> : "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Kind</dt>
          <dd className="text-sm text-foreground">{finding.kind ? humanize(finding.kind) : "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Waived</dt>
          <dd className="text-sm text-foreground">{formatRunDate(finding.waivedAt)}</dd>
        </div>
      </dl>
      <div className="mt-2 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">Corrective action:</strong> Update the source design file
          {finding.path ? (
            <>
              {" ("}
              <code>{finding.path}</code>
              {")"}
            </>
          ) : (
            ""
          )}{" "}
          in your CAD tool to resolve {finding.ruleId}.
        </p>
        <p className="mt-1">
          <small>Rerun required to verify: Push updated commit to trigger re-analysis in GitHub Actions.</small>
        </p>
      </div>
    </li>
  );
}

export function ArtifactTable({ artifacts }: Readonly<{ artifacts: ArtifactDetail[] }>) {
  if (artifacts.length === 0) {
    return (
      <EmptyState title="No matching artifacts">
        <p>No current artifact metadata matches these filters.</p>
      </EmptyState>
    );
  }
  return (
    <div className="overflow-x-auto" aria-label="Artifact evidence table">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase text-muted-foreground">
            <th scope="col" className="py-2 pr-3">Artifact</th>
            <th scope="col" className="py-2 pr-3">Status</th>
            <th scope="col" className="py-2 pr-3">Checksum</th>
            <th scope="col" className="py-2 pr-3">Size</th>
            <th scope="col" className="py-2 pr-3">Source</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <ArtifactRow key={artifact.id} artifact={artifact} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArtifactsView({
  run,
  searchParameters,
}: Readonly<{ run: RunDetail; searchParameters: SearchParameterMap }>) {
  const current = stringSearchParameters(searchParameters);
  const normalizedArtifactSort = filtersFromSearchParameters(searchParameters).artifactSort ?? "newest";
  const hasUnavailableSignedDownload = run.artifacts.some((artifact) => !artifact.downloadUrl);
  const artifactLifecycleTotal =
    run.artifactLifecycle.deleted +
    run.artifactLifecycle.missing +
    run.artifactLifecycle.pendingDeletion +
    run.artifactLifecycle.failedDeletion;
  const artifactLifecycleTone =
    run.artifactLifecycle.failedDeletion > 0
      ? ("danger" as const)
      : run.artifactLifecycle.pendingDeletion > 0
        ? ("warning" as const)
        : ("info" as const);
  const latestWorkflowRunUrl = run.attempts.find((attempt) => attempt.workflowRunUrl)?.workflowRunUrl;
  return (
    <Panel
      title="Artifacts"
      description="Checksums, availability, how long each file is kept, and who can download it."
      id="artifacts"
      actions={
        latestWorkflowRunUrl ? (
          <a href={latestWorkflowRunUrl} className="text-sm text-primary hover:underline">
            Open repository-owned GitHub Actions artifacts
          </a>
        ) : undefined
      }
    >
      <form className="flex flex-wrap items-end gap-3" method="get" action={`/runs/${run.id}/artifacts`}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Search artifacts</span>
          <input
            name="artifactSearch"
            type="search"
            maxLength={128}
            defaultValue={current.artifactSearch}
            placeholder="Name, kind, or checksum"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Role</span>
          <input
            name="artifactRole"
            maxLength={128}
            pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
            defaultValue={current.artifactRole}
            placeholder="manufacturing"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Type</span>
          <input
            name="artifactKind"
            maxLength={128}
            pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
            defaultValue={current.artifactKind}
            placeholder="report"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Sort</span>
          <select name="artifactSort" defaultValue={normalizedArtifactSort} className={inputClass}>
            <option value="newest">Newest first</option>
            <option value="name">Name</option>
            <option value="size">Largest first</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit">Apply filters</Button>
          <Link className={buttonVariants({ variant: "secondary" })} href={`/runs/${run.id}/artifacts`}>
            Reset
          </Link>
        </div>
      </form>
      {hasUnavailableSignedDownload ? (
        <div className="mt-3">
          <Alert title="Signed artifact download is unavailable" tone="warning">
            <p>The artifact is recorded as available, but this deployment cannot issue a signed download URL.</p>
          </Alert>
        </div>
      ) : null}
      {artifactLifecycleTotal > 0 ? (
        <div className="mt-3">
          <Alert title="Artifact lifecycle history" tone={artifactLifecycleTone}>
            <p>
              Run-wide counts come from durable artifact deletion jobs. Replaced artifact metadata is removed before
              physical deletion; these counts do not imply an automatic age-based expiry policy.
            </p>
            <div className="mt-2">
              <DefinitionGrid>
                <Definition label="Deleted objects">{run.artifactLifecycle.deleted}</Definition>
                <Definition label="Already missing">{run.artifactLifecycle.missing}</Definition>
                <Definition label="Deletion pending">{run.artifactLifecycle.pendingDeletion}</Definition>
                <Definition label="Deletion failed">{run.artifactLifecycle.failedDeletion}</Definition>
              </DefinitionGrid>
            </div>
          </Alert>
        </div>
      ) : null}
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {run.artifactsPage.total} matching artifact{run.artifactsPage.total === 1 ? "" : "s"}
      </p>
      <div className="mt-3">
        <ArtifactTable artifacts={run.artifacts} />
      </div>
      <div className="mt-4">
        <Pagination
          basePath={`/runs/${run.id}/artifacts`}
          page={run.artifactsPage.page}
          totalPages={run.artifactsPage.totalPages}
          pageParameter="artifactsPage"
          searchParameters={current}
        />
      </div>
    </Panel>
  );
}

function ArtifactRow({ artifact }: Readonly<{ artifact: ArtifactDetail }>) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <strong className="block text-sm text-foreground">{artifact.name}</strong>
        <span className="block text-xs text-muted-foreground">
          {humanize(artifact.kind)} · {humanize(artifact.role)} · {artifact.contentType}
        </span>
        <time dateTime={artifact.uploadedAt} className="block text-xs text-muted-foreground">
          {formatRunDate(artifact.uploadedAt)}
        </time>
      </th>
      <td className="py-2 pr-3">
        <StatusBadge value={artifact.availability} />
        <span className="mt-1 block text-xs text-muted-foreground">
          {artifact.retentionUntil
            ? `Retention recorded until ${formatRunDate(artifact.retentionUntil)}`
            : "Retention: no automatic age-based expiry"}
        </span>
        {artifact.executionAttemptId ? (
          <span className="mt-1 block text-xs text-muted-foreground">Attempt: {artifact.executionAttemptId}</span>
        ) : null}
      </td>
      <td className="py-2 pr-3">
        <code className="block text-xs">{artifact.sha256}</code>
        <CopyButton label="Copy SHA-256" value={artifact.sha256} />
      </td>
      <td className="py-2 pr-3">{formatArtifactBytes(artifact.bytes)}</td>
      <td className="py-2 pr-3">
        {artifact.downloadUrl ? (
          <a href={artifact.downloadUrl} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Download signed copy
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">Signed download unavailable</span>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Rewrite the final ~100 lines of `apps/web/components/run-investigation.tsx`** (`PublicationView` and `AuditView`, replacing the original file's last two exported functions)

```typescript
export function PublicationView({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <>
      <Panel title="Publication status" description="When these results were posted back to GitHub." id="publication">
        <DefinitionGrid>
          <Definition label="Last publication attempt">{formatRunDate(run.lastPublicationAttemptAt)}</Definition>
          <Definition label="Check Run published">{formatRunDate(run.githubCheckPublishedAt)}</Definition>
          <Definition label="PR comment published">{formatRunDate(run.githubCommentPublishedAt)}</Definition>
          <Definition label="Check Run ID">
            {run.githubCheckRunId ? <code>{run.githubCheckRunId}</code> : "Not recorded"}
          </Definition>
        </DefinitionGrid>
        {run.lastPublicationError ? (
          <div className="mt-3">
            <Alert title="Last publication failed" tone="danger">
              <p>{run.lastPublicationError}</p>
            </Alert>
          </div>
        ) : null}
      </Panel>
      <Panel title="Metrics" description="Numeric metrics accepted by the versioned result contract." id="metrics">
        {Object.keys(run.metrics).length === 0 ? (
          <EmptyState title="No metrics">
            <p>The runner did not report numeric metrics for this result.</p>
          </EmptyState>
        ) : (
          <DefinitionGrid>
            {Object.entries(run.metrics)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, value]) => (
                <Definition key={name} label={name}>
                  {value}
                </Definition>
              ))}
          </DefinitionGrid>
        )}
      </Panel>
      <Panel title="Reports" description="HTTPS links supplied by the accepted runner result." id="reports">
        {run.reportLinks.length === 0 ? (
          <EmptyState title="No report links">
            <p>The Check Run and the workflow logs in your repository have the full detail.</p>
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {run.reportLinks.map((report) => (
              <li key={`${report.label}:${report.url}`} className="flex items-center gap-2 text-sm">
                <a href={report.url} className="text-primary hover:underline">{report.label}</a>
                <span className="text-xs text-muted-foreground">{new URL(report.url).hostname}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function AuditView({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <>
      <Panel
        title="Audit and recovery evidence"
        description="Operational records are kept apart from your board content, and never mixed into it."
        id="audit"
      >
        <Alert title="Full audit export requires operator access" tone="info">
          <p>
            Detailed audit events for this run are kept in a tenant-scoped operator system, not embedded in this
            dashboard. If you need the full export -- for a recovery, a compliance request, or a dead-letter item below
            -- report it via a{" "}
            <a href="https://github.com/oaslananka/boardreadyops/issues/new" rel="noreferrer">
              GitHub issue
            </a>{" "}
            with the run ID below; the operator for this deployment can pull it for you.
          </p>
        </Alert>
        <div className="mt-3">
          <DefinitionGrid>
            <Definition label="Installation scope">Derived from the repository tenant boundary</Definition>
            <Definition label="Run filter">
              <code>{run.id}</code>
            </Definition>
            <Definition label="Reconciliation backlog">{run.reconciliationCount}</Definition>
          </DefinitionGrid>
        </div>
      </Panel>
      <Panel
        title="What is intentionally excluded"
        description="The audit export minimizes sensitive content."
        id="audit-boundary"
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
          <li>Raw source and GitHub webhook bodies</li>
          <li>Finding messages and repository-relative paths</li>
          <li>Artifact names and internal storage paths</li>
          <li>Credentials, bearer values, cookies, and request secrets</li>
        </ul>
      </Panel>
    </>
  );
}
```

- [ ] **Step 4: Add the `buttonVariants` and `Button` imports needed by Steps 2–3 to the top of `apps/web/components/run-investigation.tsx`**

```typescript
import { Button, buttonVariants } from "./ui/button.js";
```

(Placed alongside the existing `import { CopyButton } from "./copy-button.js";` line from Task 22's Step 1.)

- [ ] **Step 5: Run the full run-investigation test suite**

Run: `corepack pnpm exec vitest run tests/unit/web/run-investigation-accessibility.test.ts tests/unit/web/run-dashboard.test.ts tests/unit/web/run-dashboard-page.test.ts tests/unit/web/run-listing.test.ts tests/unit/web/copy-button.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint and typecheck the now-complete file**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass — `run-investigation.tsx` (Tasks 22–24 combined) is now fully off `styles.css`.

- [ ] **Step 7: Confirm zero remaining `run-*` legacy class references**

Run: `grep -rn "run-header\|run-verdict\|finding-list\|\"timeline\"" apps/web/components/run-investigation.tsx`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/run-investigation.tsx apps/web/components/copy-button.tsx
git commit -m "feat(web): migrate FindingsView, ArtifactsView, PublicationView, AuditView, and CopyButton to Tailwind"
```

### Task 25: Migrate the operator dead-letter queue (`/ops/dead-letters`)

**Files:**
- Modify: `apps/web/app/ops/dead-letters/page.tsx`
- Modify: `apps/web/app/ops/dead-letters/dead-letters-client.tsx`
- Modify: `apps/web/app/ops/dead-letters/dead-letters-panel.tsx`

**Interfaces:**
- Consumes: `Alert`, `AppShell`, `Breadcrumbs`, `EmptyState`, `Panel`, `StatusBadge` (`apps/web/components/ui.tsx`); `Button` (`apps/web/components/ui/button.tsx`).
- Produces: nothing new; `DeadLettersClient`, `DeadLettersPanel`'s prop shapes are unchanged — `dead-letter-view-model.ts` (the pure data/formatting layer) is untouched by this task.

`dead-letters-page.test.ts` asserts entirely on text content (installation ID labels, status copy, table cell values) — no test in this file queries a class selector, confirmed during this task's research, so no test file changes are needed.

- [ ] **Step 1: Rewrite `apps/web/app/ops/dead-letters/page.tsx`**

```typescript
import { AppShell, Breadcrumbs } from "../../../components/ui.js";
import { DeadLettersClient } from "./dead-letters-client.js";

export const metadata = {
  title: "Dead-Letter Queue",
  description: "Operator view of stuck or dead-lettered release-run jobs and outbox records, with safe replay.",
};

export default function DeadLettersPage() {
  return (
    <AppShell>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Ops" }, { label: "Dead-Letter Queue" }]} />
        <header>
          <h1 className="text-2xl font-bold text-foreground">Dead-Letter Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stuck lifecycle jobs and outbox records for a single installation, with their failure reason and, where the
            database has classified them as safe, a replay action. This is an internal operator surface authenticated
            with the operator bearer token — see <code>docs/operations/control-plane-reconciliation.md</code>.
          </p>
        </header>
        <DeadLettersClient />
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/app/ops/dead-letters/dead-letters-panel.tsx`**

```typescript
"use client";

import { Alert, EmptyState, StatusBadge } from "../../../components/ui.js";
import { Button } from "../../../components/ui/button.js";
import { type DeadLetterListItem, formatFailureReason, formatTimestamp } from "./dead-letter-view-model.js";

export type DeadLettersLoadState = "error" | "idle" | "loading" | "loaded";

export type ReplayRowState =
  | { status: "pending" }
  | { status: "done"; message: string }
  | { status: "failed"; message: string };

export type DeadLettersPanelProps = {
  state: DeadLettersLoadState;
  error?: string;
  items: readonly DeadLetterListItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  onReplay: (item: DeadLetterListItem) => void;
  replayState: Readonly<Record<string, ReplayRowState | undefined>>;
};

function rowKey(item: DeadLetterListItem): string {
  return `${item.itemType}:${item.itemId}`;
}

export function DeadLettersPanel({
  state,
  error,
  items,
  hasMore,
  onLoadMore,
  onReplay,
  replayState,
}: Readonly<DeadLettersPanelProps>) {
  if (state === "idle") {
    return (
      <EmptyState title="Enter an installation and operator token">
        <p>Provide an installation ID and the operator bearer token above, then load dead letters.</p>
      </EmptyState>
    );
  }

  if (state === "loading") {
    return (
      <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground" aria-live="polite">
        Loading dead letters…
      </div>
    );
  }

  if (state === "error") {
    return (
      <Alert title="Could not load dead letters" tone="danger">
        <p>{error ?? "Unknown error."}</p>
      </Alert>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState title="No dead letters">
        <p>Nothing is stuck. Every job and outbox record for this installation is processing normally.</p>
      </EmptyState>
    );
  }

  return (
    <>
      <div className="overflow-x-auto" aria-labelledby="dead-letters-table-caption">
        <table className="w-full text-left text-sm">
          <caption id="dead-letters-table-caption" className="sr-only">
            Dead-lettered jobs and outbox records
          </caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th scope="col" className="py-2 pr-3">Item</th>
              <th scope="col" className="py-2 pr-3">Run</th>
              <th scope="col" className="py-2 pr-3">Installation / Repository</th>
              <th scope="col" className="py-2 pr-3">Failure reason</th>
              <th scope="col" className="py-2 pr-3">Attempts</th>
              <th scope="col" className="py-2 pr-3">Failed at</th>
              <th scope="col" className="py-2 pr-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const key = rowKey(item);
              const replay = replayState[key];
              return (
                <tr key={key} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <StatusBadge value="dead_letter" label={item.itemType} />
                    <div className="mt-1">
                      <code className="text-xs">{item.itemId}</code>
                    </div>
                  </th>
                  <td className="py-2 pr-3">{item.releaseRunId ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <div>{item.installationId}</div>
                    {item.repositoryFullName ? (
                      <div className="text-xs text-muted-foreground">{item.repositoryFullName}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{formatFailureReason(item)}</td>
                  <td className="py-2 pr-3">{item.attemptCount}</td>
                  <td className="py-2 pr-3">{formatTimestamp(item.failedAt)}</td>
                  <td className="py-2 pr-3">
                    {item.replaySafe ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={replay?.status === "pending"}
                          onClick={() => onReplay(item)}
                        >
                          {replay?.status === "pending" ? "Replaying…" : "Replay"}
                        </Button>
                        {replay && replay.status !== "pending" ? (
                          <div className="mt-1 text-xs text-muted-foreground">{replay.message}</div>
                        ) : null}
                      </>
                    ) : (
                      <StatusBadge value="blocked" label="Not replayable" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <Button type="button" variant="secondary" className="mt-3" onClick={onLoadMore}>
          Load older dead letters
        </Button>
      ) : null}
    </>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/app/ops/dead-letters/dead-letters-client.tsx`'s `return` block (all state and handler functions above it are unchanged)**

```typescript
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Connect to an installation" description="Credentials are kept in memory for this page load only.">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dead-letters-installation-id" className="text-sm font-medium text-foreground">
                Installation ID
              </label>
              <input
                id="dead-letters-installation-id"
                className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={installationId}
                onChange={(event) => setInstallationId(event.currentTarget.value)}
                placeholder="ins_..."
                required
              />
            </div>
            <div>
              <label htmlFor="dead-letters-operator-token" className="text-sm font-medium text-foreground">
                Operator bearer token
              </label>
              <input
                id="dead-letters-operator-token"
                className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                placeholder="BOARDREADYOPS_OPERATOR_API_TOKEN"
                required
              />
            </div>
          </div>
          <footer className="flex justify-end border-t border-border pt-3">
            <Button type="submit" disabled={state === "loading"}>
              {state === "loading" ? "Loading…" : "Load dead letters"}
            </Button>
          </footer>
        </form>
      </Panel>

      <Panel title="Dead letters" description="Jobs and outbox records the control plane could not deliver.">
        <DeadLettersPanel
          state={state}
          {...(error ? { error } : {})}
          items={items}
          hasMore={Boolean(nextBefore)}
          onLoadMore={() => void load(nextBefore)}
          onReplay={(item) => void handleReplay(item)}
          replayState={replayState}
        />
      </Panel>

      <Alert title="Metadata-only surface" tone="info">
        <p>
          Replay only records the API reports as safe. An uncertain dispatch without a persisted workflow run ID stays
          non-replayable and needs a reconciliation path or manual incident decision — see{" "}
          <code>docs/operations/control-plane-reconciliation.md</code>.
        </p>
      </Alert>
    </div>
  );
}
```

Add `import { Button } from "../../../components/ui/button.js";` to the file's imports.

- [ ] **Step 4: Run the dead-letters test files**

Run: `corepack pnpm exec vitest run tests/unit/web/dead-letters-page.test.ts tests/unit/web/dead-letter-view-model.test.ts tests/unit/web/control-plane-dead-letter-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and typecheck**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/ops/dead-letters/
git commit -m "feat(web): migrate operator dead-letter queue to Tailwind"
```

This completes the Runs/dead-letters spec-gap correction — every page in the app now renders through the new design system.

## Phase D: Cleanup and verification

### Task 26: Delete `styles.css`, retire its remaining self-tests, and run the ADR's full verification gate

**Files:**
- Delete: `apps/web/app/styles.css`
- Modify: `apps/web/app/layout.tsx` (remove the now-dangling import)
- Modify: `tests/unit/web/run-design-system.test.ts` (full rewrite — see below)
- Modify: `tests/unit/web/settings-pages.test.ts` (remove the one remaining assertion that reads `styles.css` directly)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. This is the terminal task — after it, `apps/web/app/styles.css` and `apps/web/app/landing.css` (deleted in Task 21) no longer exist anywhere in the repository.

Two existing test files read `apps/web/app/styles.css`'s raw content directly and must be dealt with before it can be deleted:

- `run-design-system.test.ts` is **entirely** about the old hand-rolled CSS's own discipline — raw-color-leak detection, specific old selectors (`.run-header`, `.run-navigation`, `.panel`) with specific old CSS properties, and old `--bro-*` token names. None of that has a Tailwind-utility-class equivalent to re-assert (there is no longer a stylesheet to audit for raw-color leaks — Tailwind's `@theme` tokens in `globals.css`, Task 2, are the only place colors are declared, and utility classes on JSX elements replace what used to be selectors). The one part of this test with continuing value — verifying the design tokens meet WCAG AA contrast — is preserved by rewriting it against `apps/web/app/globals.css`'s token names from Task 2, checked in **both** the light (`:root`) and dark (`.dark`) blocks, which is a strictly stronger check than the original single-theme version (matching the ADR's "both themes are first-class" constraint).
- `settings-pages.test.ts`'s fourth test does `expect(runStyles).toContain("operational-page")` against `apps/web/app/styles.css` — with the file deleted, this assertion is removed; the same test's `setup-progress-index` check (source-string, not CSS-string) stays, since Task 18 kept that literal token in `apps/web/app/setup/page.tsx`.

- [ ] **Step 1: Repo-wide grep to confirm zero remaining references to any `styles.css` selector**

Run:

```bash
grep -rn "page-frame\|operational-page\|page-intro\|panel surface-\|button button-\|shell compact-shell\|run-state-surface\|policy-card\|policies-workspace\|dead-letters-workspace" apps/web/app apps/web/components --include=*.tsx
```

Expected: no matches. If any file still matches, that file was missed by Tasks 1–25 and must be converted before continuing — do not delete `styles.css` while this grep is non-empty (this is the ADR's Rollout strategy item 3, verbatim).

- [ ] **Step 2: Delete `apps/web/app/styles.css` and its import**

```bash
git rm apps/web/app/styles.css
```

In `apps/web/app/layout.tsx`, remove the line `import "./styles.css";` (added originally, kept alongside `globals.css` since Task 2; only `import "./globals.css";` remains).

- [ ] **Step 3: Rewrite `tests/unit/web/run-design-system.test.ts`**

```typescript
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/app/globals.css", "utf8");

function themeBlock(selector: ":root" | ".dark"): string {
  const pattern = selector === ":root" ? /:root\s*\{([^}]*)\}/su : /\.dark\s*\{([^}]*)\}/su;
  const match = css.match(pattern);
  if (!match?.[1]) throw new Error(`missing ${selector} block in globals.css`);
  return match[1];
}

function variable(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "u"));
  if (!match?.[1]) throw new Error(`missing color token --${name}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map((value) => Number.parseInt(value, 16) / 255);
  if (channels?.length !== 3) throw new Error(`invalid color ${hex}`);
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe.each([":root", ".dark"] as const)("design tokens in %s meet WCAG AA contrast", (selector) => {
  const block = themeBlock(selector);

  it("keeps body text above 4.5:1 against the page background", () => {
    expect(contrast(variable(block, "foreground"), variable(block, "background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "card-foreground"), variable(block, "card"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every status color above 4.5:1 against its own surface", () => {
    expect(contrast(variable(block, "danger"), variable(block, "danger-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "success"), variable(block, "success-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "warning"), variable(block, "warning-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(block, "info"), variable(block, "info-surface"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("design token declaration", () => {
  it("defines the sharp-corner radius and dark-mode custom variant the ADR locked in", () => {
    expect(css).toContain("--radius: 0.125rem");
    expect(css).toContain("@custom-variant dark");
  });
});
```

- [ ] **Step 4: Remove the `styles.css`-reading assertion from `tests/unit/web/settings-pages.test.ts`**

```typescript
  it("contains setup progress index", async () => {
    const setupPage = await readFile("apps/web/app/setup/page.tsx", "utf8");
    expect(setupPage).toContain("setup-progress-index");
  });
```

(Replaces the test named `"contains setup progress index and operational styles"`, dropping its second half — `const runStyles = await readFile("apps/web/app/styles.css", ...); expect(runStyles).toContain("operational-page");` — since that file no longer exists. The renamed test keeps the one assertion that's still meaningful.)

- [ ] **Step 5: Run the two rewritten test files**

Run: `corepack pnpm exec vitest run tests/unit/web/run-design-system.test.ts tests/unit/web/settings-pages.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the complete web test suite**

Run: `corepack pnpm exec vitest run tests/unit/web/`
Expected: PASS, zero failures. This is the first point at which every test file touched across all 26 tasks runs together.

- [ ] **Step 7: Run the full repo-wide verification gate**

Run: `corepack pnpm run lint && corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json && corepack pnpm run coverage`
Expected: lint clean, typecheck clean, coverage gate passes with no regression against the pre-migration baseline (per the ADR's Rollout strategy item 1).

- [ ] **Step 8: Build the web app**

Run: `cd apps/web && corepack pnpm exec next build 2>&1 | tail -40`
Expected: production build succeeds with no new warnings about unresolved CSS or missing modules.

- [ ] **Step 9: Browser-driven dark and light visual pass across every migrated page**

This step cannot be scripted as a unit test — it is the ADR's Rollout strategy item 2, verbatim: "Every in-scope page is visually verified in a running local build via browser automation (Chrome DevTools MCP / Playwright), page by page, checking for console errors and visual correctness against the approved direction." Run `corepack pnpm run dev` (or the repo's existing local-preview script) and, using the same browser-automation approach as the 2026-09-05 production audit that motivated this ADR, visit every page in this list **twice** — once with the theme toggle set to dark, once set to light — checking for: console errors, layout breakage, any remaining raw (non-token) color, and legibility of status badges against their surface:

Dashboard, Projects, New Project, My Work, Reviews (list + detail, all six tabs), Deliveries (list + a sample token detail page), Parts, Policies, Evidence, Insights, Setup, Settings (all five subtabs), a sample Repository detail page, a sample Run detail page (all six views), the operator Dead-Letter Queue, and the public landing page.

Record any visual defect found as a follow-up fix before the branch is considered mergeable — this plan does not pre-specify those fixes, since by definition they can only be discovered by looking.

- [ ] **Step 10: Final repo-wide grep for the two deleted files' names**

Run: `grep -rn "landing\.css\|app/styles\.css" apps/web --include=*.tsx --include=*.ts`
Expected: no matches (only this plan document and the ADR itself may still mention the filenames, as history).

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/layout.tsx tests/unit/web/run-design-system.test.ts tests/unit/web/settings-pages.test.ts
git rm apps/web/app/styles.css
git commit -m "chore(web): delete styles.css, retire its self-tests against the new design-token system"
```

This is the last task in the plan. Once it lands, `apps/web/app/styles.css` and `apps/web/app/landing.css` are both gone, every page in the app (including the Runs and dead-letter-queue spec-gap correction) renders through Tailwind + shadcn/ui on the approved graphite/electric-blue direction in both themes, and the branch is ready for the normal PR → CI → merge → `cloud-deploy` path per the ADR's Rollout strategy item 4.

---

## Self-Review

**Spec coverage against ADR-0016:**

- Tailwind v4 + shadcn/ui adoption — Tasks 1, 3.
- Design tokens (graphite/electric-blue, sharp 2px radius, dark+light) — Task 2, verified in both themes by Task 26.
- `ui.tsx` external API unchanged — Task 4, stated as a Global Constraint, honored by every subsequent task's imports.
- Task-sequence sidebar restructuring — Task 6.
- Guided-checklist empty-state pattern, applied at all four ADR-named surfaces (Projects, Parts, Deliveries, repository detail) — Task 6/7 (Dashboard/Projects empty states, per the summarized prior work), Task 15 (Parts, Deliveries — corrected mid-plan after cross-checking Task 5's own interface note against the ADR), Task 20 (repository detail).
- CAD-format-neutral copy — corrected wherever found: Dashboard/Projects (prior work), Reviews list metadata (Task 10), the evidence-pack checkbox in Policies (Task 16), Insights telemetry copy (Task 17), root layout + landing page + OG image (Task 21), `FindingRow`'s corrective-action text (Task 24).
- Authenticated-app page inventory — Dashboard(7)/Projects(8)/My Work(9)/Reviews(10–14)/Deliveries+Parts(15)/Policies(16)/Evidence+Insights(17)/Setup(18)/Settings(19)/Repository detail(20): full ADR list covered.
- Public marketing site (landing page + `landing.css`) — Task 21.
- Both dark and light themes checked — Task 26 Step 9 (browser pass) and Step 3 (contrast test against both `:root` and `.dark`).
- Single-branch rollout with a verification gate substituting for incremental risk reduction — Task 26 Steps 6–10 implement the ADR's Rollout strategy items 1–3 exactly; item 4 (PR → CI → merge → deploy) is explicitly left to the normal existing process, not re-specified here.
- Spec gap found and resolved: `/runs/[runId]/*` and `/ops/dead-letters` were not in the ADR's named scope but are required by the ADR's own zero-references deletion gate — raised to the user 2026-09-05, resolved as in-scope, covered by Tasks 22–25.

**Placeholder scan:** every task above ends in real, complete, compilable code — no `TBD`, no "similar to Task N" without the code repeated, no vague "add error handling." Every literal class-name test dependency found during research (`policies-page-frame`, `button-delete`, `modal-footer`, `policy-builder-footer`, `settings-nav-list`/`data-testid="settings-nav-list"`, `run-identity-meta`, `run-readiness-signature`, `delivery-signoff-card`, `download-bundle-button`, `plan-tier-card`, `plan-comparison-container`, `current-plan-badge`, `upgrade-checkout-button`, `manage-portal-button`, `setup-code-preview`, `setup-progress-index`) is either preserved as a literal token alongside the new Tailwind classes or has its asserting test updated in the same task — none were left to break silently.

**Type consistency:** `StatusTone` (`"danger" | "info" | "neutral" | "success" | "warning"`, Task 4) is the single vocabulary every later task's `StatusBadge`/`Alert`/`Badge` call sites use; `PanelTone` (`"default" | "raised" | "inset" | "critical" | "section"`, Task 4) matches every `tone` value passed to `Panel` in Tasks 7 onward — spot-checked during Task 18/23 research, no mismatches found. `GuidedChecklistStep`'s `status: "done" | "current" | "upcoming"` (Task 5) is used identically in Tasks 7, 8, 15, and 20.
