export interface ActionDocumentationContract {
  inputs?: Record<string, { default?: unknown; description?: string }>;
  outputs?: Record<string, { description?: string }>;
}

export function renderActionDocs(document: string, action: ActionDocumentationContract): string;

export function main(root?: string): Promise<void>;
