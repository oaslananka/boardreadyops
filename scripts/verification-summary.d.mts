import type { VerificationStatusEntry } from "./run-monorepo-integration.mjs";

export interface IntegrationVerificationSummary {
  readonly required: VerificationStatusEntry;
  readonly postgres: VerificationStatusEntry;
  readonly kicad: VerificationStatusEntry;
}

export function renderVerificationSummary(summary?: IntegrationVerificationSummary): string;
export function readIntegrationSummary(path?: string): IntegrationVerificationSummary;
