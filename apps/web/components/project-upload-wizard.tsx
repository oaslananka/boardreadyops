"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.js";

export type ProjectUploadWizardProps = Readonly<{
  workspaceId?: string;
  onComplete?: (reviewId: string) => void;
  signedIn?: boolean;
  hasInstallation?: boolean;
}>;

export function ProjectUploadWizard({
  workspaceId: _workspaceId = "default",
  signedIn = false,
  hasInstallation = false,
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
        <p className="text-foreground">
          {hasInstallation && signedIn
            ? "Your GitHub App is connected. Choose a repository in Setup to check its readiness; no files change until you review a setup pull request."
            : signedIn
              ? "Your GitHub account is connected, but no App installation is available. Choose an installation in Setup."
              : "Sign in with GitHub to choose a repository for your first readiness check."}
        </p>
        <Link
          href={signedIn ? "/setup" : "/api/auth/github/login?return_to=%2Fsetup"}
          className="inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {hasInstallation && signedIn
            ? "Choose a repository"
            : signedIn
              ? "Connect GitHub App"
              : "Sign in with GitHub"}
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
