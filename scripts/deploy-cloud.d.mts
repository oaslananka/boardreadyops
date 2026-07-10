export interface DeployOptions {
  readonly appName: string;
  readonly container: string;
  readonly healthUrl: string;
  readonly canaryHealthUrl: string;
  readonly imageRepository: string;
  readonly runtimeEnvFile: string;
  readonly artifactVolume: string;
  readonly network: string;
  readonly livePublish: string;
  readonly canaryPublish: string;
  readonly revision: string;
  readonly skipInstall: boolean;
  readonly dryRun: boolean;
  readonly healthAttempts: number;
  readonly healthDelayMs: number;
}

export interface RuntimeContainerArgsInput {
  readonly name: string;
  readonly image: string;
  readonly publish: string;
  readonly networkAlias: string;
  readonly restart: string;
  readonly revision: string;
  readonly options: DeployOptions;
}

export const defaultDeployOptions: DeployOptions;

export function readDeployOptions(env?: Readonly<Record<string, string | undefined>>): DeployOptions;
export function dockerTagFromRevision(revision: string): string;
export function runtimeContainerArgs(input: RuntimeContainerArgsInput): string[];
export function deployCloud(options?: DeployOptions): Promise<void>;
