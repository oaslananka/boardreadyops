export type FindingTemplateInput = {
  ruleId: string;
  severity: string;
  message: string;
  path?: string | undefined;
};

export type ReadinessResultTemplateInput = {
  status: string;
  decision: string | null;
  findings?: readonly FindingTemplateInput[];
  detailsUrl?: string | undefined;
};

export declare function buildReadinessCheckOutput(input: ReadinessResultTemplateInput): {
  title: string;
  summary: string;
};

export declare function buildReadinessPrComment(input: ReadinessResultTemplateInput): string;
