export type BinaryReleasePublishResult = {
  uploaded: number;
  attempts: number;
  maximumConcurrency: number;
};

export type BinaryReleasePublishOptions = {
  root?: string;
  releaseTag: string;
  concurrency?: number;
  maxAttempts?: number;
  runGh?: (args: string[]) => void | Promise<void>;
  sleep?: (milliseconds: number) => void | Promise<void>;
};

export function main(argv?: string[], root?: string): Promise<void>;
export function releaseAssetPaths(root?: string): string[];
export function publishBinaryReleaseAssets(options: BinaryReleasePublishOptions): Promise<BinaryReleasePublishResult>;
