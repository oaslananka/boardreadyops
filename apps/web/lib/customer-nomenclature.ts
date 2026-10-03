const planLabels: Readonly<Record<string, string>> = {
  community: "Free",
  free: "Free",
  team: "Team",
  business: "Business",
  pilot: "Pilot",
  enterprise: "Enterprise",
};

export function customerPlanLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "Unknown";
  return planLabels[normalized] ?? customerStatusLabel(normalized);
}

export function customerStatusLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "Unknown";
  return normalized
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
