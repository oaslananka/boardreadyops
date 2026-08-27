export type DfmVendor = "valor" | "generic";
export type DfmStatus = "pending" | "running" | "passed" | "failed" | "needs_review";

export type DfmSubmission = {
  id: string;
  tenantId: string;
  reviewId: string;
  vendor: DfmVendor;
  artifactKey: string;
  status: DfmStatus;
  resultUrl?: string;
  provenance: { vendor: DfmVendor; profile: string; version: string };
  createdAt: string;
  updatedAt: string;
};

export interface DfmAdapter {
  submit(input: {
    tenantId: string;
    reviewId: string;
    vendor: DfmVendor;
    artifactKey: string;
    profile: string;
  }): Promise<DfmSubmission>;
  getStatus(tenantId: string, submissionId: string): Promise<DfmSubmission | null>;
  requiresHumanReview(submission: DfmSubmission): boolean;
}

export class InMemoryDfmAdapter implements DfmAdapter {
  private readonly subs = new Map<string, DfmSubmission>();
  async submit(input: {
    tenantId: string;
    reviewId: string;
    vendor: DfmVendor;
    artifactKey: string;
    profile: string;
  }): Promise<DfmSubmission> {
    const id = `dfm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sub: DfmSubmission = {
      id,
      tenantId: input.tenantId,
      reviewId: input.reviewId,
      vendor: input.vendor,
      artifactKey: input.artifactKey,
      status: "pending",
      provenance: { vendor: input.vendor, profile: input.profile, version: "1.0" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.subs.set(id, sub);
    // Simulate async progression to running, then needs_review
    setTimeout(() => {
      const cur = this.subs.get(id);
      if (cur) this.subs.set(id, { ...cur, status: "running", updatedAt: new Date().toISOString() });
    }, 10);
    return sub;
  }
  async getStatus(_tenantId: string, submissionId: string): Promise<DfmSubmission | null> {
    return this.subs.get(submissionId) ?? null;
  }
  requiresHumanReview(submission: DfmSubmission): boolean {
    // DFM never auto-passes a review gate; human review always required
    return submission.status !== "passed" || true;
  }
}
