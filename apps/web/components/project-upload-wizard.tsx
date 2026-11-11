"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.js";

export type ProjectSourceRepository = Readonly<{
  id: string;
  fullName: string;
  hasSetupRevision: boolean;
}>;

export type ProjectUploadWizardProps = Readonly<{
  workspaceId?: string;
  onComplete?: (reviewId: string) => void;
  signedIn?: boolean;
  accessUnavailable?: boolean;
  repositories?: readonly ProjectSourceRepository[];
}>;

export function ProjectUploadWizard({
  workspaceId: _workspaceId = "default",
  signedIn = false,
  accessUnavailable = false,
  repositories = [],
}: ProjectUploadWizardProps) {
  return (
    <Tabs defaultValue="github">
      <TabsList aria-label="Ingestion Source">
        <TabsTrigger value="zip">Upload Package (Zip) — Unavailable</TabsTrigger>
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
        {accessUnavailable ? (
          <>
            <p role="status" className="text-foreground">
              We could not verify your current GitHub repository access. No repository is offered until GitHub grants
              can be checked again.
            </p>
            <Link href="/setup" className="font-medium text-primary underline underline-offset-2">
              Check repository access in Setup
            </Link>
          </>
        ) : signedIn && repositories.length > 0 ? (
          <>
            <p className="font-medium text-foreground">Choose a repository to review its setup</p>
            <p className="text-muted-foreground">
              These are the repositories your current GitHub App installations allow you to access. Choose one to check
              its readiness setup; this does not create a run or modify a repository.
            </p>
            <ul
              aria-label="Authorized GitHub repositories"
              className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2"
            >
              {repositories.map((repository) => (
                <li key={repository.id}>
                  <Link
                    href={`/setup?repositoryId=${encodeURIComponent(repository.id)}`}
                    className="flex min-w-0 flex-col rounded-md border border-border px-3 py-2 text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="break-all font-medium text-primary">{repository.fullName}</span>
                    <span className="text-xs text-muted-foreground">
                      {repository.hasSetupRevision ? "Review current setup" : "Setup not started"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/setup" className="w-fit font-medium text-primary underline underline-offset-2">
              Open full repository setup
            </Link>
          </>
        ) : signedIn ? (
          <>
            <p className="text-foreground">
              No authorized repositories are visible for this GitHub session yet. Check the installation and repository
              selection before starting a review.
            </p>
            <Link href="/setup" className="w-fit font-medium text-primary underline underline-offset-2">
              Check GitHub App access
            </Link>
          </>
        ) : (
          <>
            <p className="text-foreground">
              Sign in with GitHub to choose a repository for readiness checks. A reviewed setup pull request is needed
              before the repository can run its first check.
            </p>
            <Link
              href="/api/auth/github/login?return_to=%2Fsetup"
              className="inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in with GitHub
            </Link>
          </>
        )}
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
