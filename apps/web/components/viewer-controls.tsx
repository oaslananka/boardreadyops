"use client";

import { Avatar, AvatarFallback } from "./ui/avatar.js";
import { buttonVariants } from "./ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";

/**
 * Sign-in state in the topbar.
 *
 * Signing in is a link because it starts a redirect the viewer initiated. Signing out stays a
 * form POST — inside the menu item rather than replacing it — so a third-party page cannot sign
 * someone out by embedding a link to it.
 */
export function ViewerControls({ login }: Readonly<{ login: string | undefined }>) {
  if (!login) {
    return (
      <a
        className={buttonVariants({
          variant: "outline",
          size: "sm",
          className: "min-h-11 shrink-0 whitespace-nowrap md:min-h-8",
        })}
        href="/api/auth/github/login"
      >
        Sign in<span className="hidden sm:inline">{" with GitHub"}</span>
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${login}`}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-9"
        >
          <Avatar>
            <AvatarFallback>{login.slice(0, 2)}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline">{login}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Signed in as {login}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings/billing">Workspace settings</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="https://docs.boardreadyops.com" target="_blank" rel="noreferrer">
            Documentation
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="w-full text-left">
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
