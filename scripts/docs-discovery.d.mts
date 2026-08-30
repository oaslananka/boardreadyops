export interface DocsDiscoveryOptions {
  repositoryRoot?: string;
  siteDir: string;
}

export interface DocsDiscoveryResult {
  markdownPaths: string[];
  siteUrl: string;
}

export function generateDocsDiscovery(options: DocsDiscoveryOptions): Promise<DocsDiscoveryResult>;
