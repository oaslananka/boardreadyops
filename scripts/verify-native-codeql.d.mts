export interface NativeCodeqlCheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  app?: { slug?: string };
  html_url?: string;
}

export type NativeCodeqlDecision =
  | { state: "pending" }
  | { state: "success" }
  | { state: "failure"; conclusion: string; url?: string };

export function nativeCodeqlDecision(checkRuns: NativeCodeqlCheckRun[] | null, headSha: string): NativeCodeqlDecision;
export function waitForNativeCodeql(
  readChecks: () => Promise<NativeCodeqlCheckRun[]>,
  headSha: string,
  options?: { attempts?: number; pause?: () => void | Promise<void> },
): Promise<void>;
export function main(): Promise<void>;
