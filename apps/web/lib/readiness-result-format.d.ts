export type FindingTemplateInput = {
  ruleId: string;
  severity: string;
  message: string;
  path?: string | undefined;
};

export type ArtifactTemplateInput = {
  kind: string;
  name: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  role: string;
};

export type ReportLinkTemplateInput = {
  label: string;
  url: string;
};

export type ReadinessResultTemplateInput = {
  status: string;
  decision: string | null;
  findings?: readonly FindingTemplateInput[];
  artifacts?: readonly ArtifactTemplateInput[];
  metrics?: Readonly<Record<string, number>>;
  reportLinks?: readonly ReportLinkTemplateInput[];
  detailsUrl?: string | undefined;
};

export declare function buildReadinessCheckOutput(input: ReadinessResultTemplateInput): {
  title: string;
  summary: string;
};

export declare function buildReadinessPrComment(input: ReadinessResultTemplateInput): string;
