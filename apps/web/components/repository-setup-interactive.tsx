"use client";

import type { RepositorySetupPreset } from "@boardreadyops/cloud-core/repository-setup";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Definition, DefinitionGrid, Panel, StatusBadge } from "./ui.js";
import { YamlSyntaxHighlighter } from "./yaml-syntax-highlighter.js";

export type RepositorySetupInteractiveProps = {
  presets: readonly RepositorySetupPreset[];
  initialPresetId: string;
  presetVersion: number;
  workflowPath: string;
  workflowContractVersion: number;
  workflowSource: string;
};

export function RepositorySetupInteractive({
  presets,
  initialPresetId,
  presetVersion,
  workflowPath,
  workflowContractVersion,
  workflowSource,
}: Readonly<RepositorySetupInteractiveProps>) {
  const [selectedId, setSelectedId] = useState(initialPresetId);

  const fallback = presets[0];
  if (!fallback) throw new Error("At least one preset must be provided");
  const activePreset = presets.find((p) => p.id === selectedId) ?? fallback;

  const handleSelectPreset = useCallback((presetId: string) => {
    setSelectedId(presetId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("preset", presetId);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  return (
    <>
      <Panel
        id="policy-preset"
        title="1. Choose a release policy"
        description={`Preset v${presetVersion}. Switching presets starts a new revision; runs you have already done keep the policy they were checked against.`}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {presets.map((preset) => {
            const isSelected = preset.id === activePreset.id;
            return (
              <article
                className={`flex flex-col gap-2 rounded-md border p-4 transition-all duration-150 ${
                  isSelected
                    ? "border-primary bg-card shadow-sm shadow-primary/10 ring-1 ring-primary/40"
                    : "border-border bg-card hover:border-primary/40 hover:bg-muted/10"
                }`}
                data-selected={isSelected || undefined}
                key={preset.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-foreground">{preset.name}</h3>
                  {isSelected ? <StatusBadge value="selected" label="Selected" /> : null}
                </div>
                <p className="text-xs uppercase text-muted-foreground">
                  {isSelected ? "Current preview" : "Available release policy"}
                </p>
                <p className="text-sm text-muted-foreground">{preset.description}</p>
                <DefinitionGrid>
                  <Definition label="Release mode">{preset.releaseMode}</Definition>
                  <Definition label="Fail threshold">{preset.failOn}</Definition>
                </DefinitionGrid>
                <Link
                  className={`mt-2 inline-flex w-fit items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
                      : "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                  href={`/setup?preset=${preset.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSelectPreset(preset.id);
                  }}
                  aria-current={isSelected ? "page" : undefined}
                >
                  {isSelected ? `Active: ${preset.name}` : `Preview ${preset.name}`}
                </Link>
              </article>
            );
          })}
        </div>
      </Panel>

      <Panel
        id="proposed-files"
        title="2. Review repository-owned files"
        description="These are the only repository-owned files required for the setup flow. Commit them through a reviewed pull request."
      >
        <div className="flex flex-col gap-4">
          <article className="rounded-md border border-border bg-card p-4 transition-all">
            <header className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-foreground">boardreadyops.yml</h3>
                <p className="text-xs text-muted-foreground">Selected preset: {activePreset.name}</p>
              </div>
              <StatusBadge value="new" label="New or replace intentionally" />
            </header>
            <div className="mt-3">
              <DefinitionGrid>
                <Definition label="Blocks">Enabled findings at {activePreset.failOn} severity or above</Definition>
                <Definition label="Warns">Enabled findings below {activePreset.failOn} severity</Definition>
                <Definition label="Ignores">Rules explicitly set to false in the preview</Definition>
              </DefinitionGrid>
            </div>
            <YamlSyntaxHighlighter
              code={activePreset.config}
              filename="boardreadyops.yml"
              presetName={activePreset.name}
            />
          </article>

          <article className="rounded-md border border-border bg-card p-4">
            <header className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-foreground">.github/workflows/{workflowPath}</h3>
                <p className="text-xs text-muted-foreground">
                  Canonical v1 runner workflow, contract v{workflowContractVersion}
                </p>
              </div>
              <StatusBadge value="review" label="Review before copying" />
            </header>
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
              <li>
                Open the{" "}
                <a href={workflowSource} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                  canonical v1 workflow source
                </a>{" "}
                and review its pinned actions, permissions, inputs, and timeouts.
              </li>
              <li>
                Copy it unchanged to <code>.github/workflows/{workflowPath}</code> on a feature branch.
              </li>
              <li>Open a pull request and let your repository ruleset and required checks approve the change.</li>
            </ol>
          </article>
        </div>
      </Panel>
    </>
  );
}
