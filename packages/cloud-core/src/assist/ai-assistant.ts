export type AiAssistInput = {
  reviewId: string;
  tenantId: string;
  findings: Array<{ fingerprint: string; ruleId: string; message: string }>;
  comments: Array<{ body: string }>;
};

export type AiAssistResult = {
  summary: string;
  duplicateGroups: Array<{ fingerprints: string[]; reason: string }>;
  waiverWarnings: Array<{ fingerprint: string; issue: string }>;
  provider: string;
  model: string;
  version: string;
  inputDigest: string;
  isProbabilistic: true;
};

interface AiReviewAssistant {
  enabled(tenantId: string): boolean;
  summarize(input: AiAssistInput): Promise<AiAssistResult>;
}

export class NoOpAiAssistant implements AiReviewAssistant {
  enabled(_tenantId: string): boolean {
    // Default OFF per spec, only enabled via feature flag env
    return process.env.AI_ASSIST_ENABLED === "true";
  }
  async summarize(input: AiAssistInput): Promise<AiAssistResult> {
    if (!this.enabled(input.tenantId)) throw new Error("AI assist is disabled for this tenant");
    // Deterministic stub that never makes gate/waiver/approval decisions
    const duplicateGroups =
      input.findings.length >= 2
        ? [{ fingerprints: input.findings.slice(0, 2).map((f) => f.fingerprint), reason: "Similar rule and message" }]
        : [];
    const waiverWarnings = input.findings
      .filter((f) => f.message.length < 20)
      .map((f) => ({ fingerprint: f.fingerprint, issue: "Reason may be too brief for accepted_risk" }))
      .slice(0, 3);
    return {
      summary: `Review ${input.reviewId} has ${input.findings.length} findings requiring triage.`,
      duplicateGroups,
      waiverWarnings,
      provider: "stub",
      model: "stub-v1",
      version: "1.0.0",
      inputDigest: `stub_${input.reviewId}`,
      isProbabilistic: true,
    };
  }
}
