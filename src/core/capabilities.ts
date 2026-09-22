export interface SecurityCapability {
  id: string;
  name: string;
  category: "data-privacy" | "sandboxing" | "auth" | "tenancy";
  description: string;
  status: "enforced" | "planned" | "not-supported";
  isolationLevel?: "in-process" | "process" | "container" | "vm";
}

export const SECURITY_CAPABILITY_REGISTRY: Record<string, SecurityCapability> = {
  uploadConsent: {
    id: "uploadConsent",
    name: "Explicit Cloud Upload Consent",
    category: "data-privacy",
    description: "Requires explicit upload mode selection (metadata, snapshots, or source) in addition to auth token.",
    status: "enforced",
  },
  pluginTrustModel: {
    id: "pluginTrustModel",
    name: "Trusted In-Process Plugin Execution",
    category: "sandboxing",
    description: "Plugins run in-process as trusted modules within the execution context.",
    status: "enforced",
    isolationLevel: "in-process",
  },
  tenantIsolationRLS: {
    id: "tenantIsolationRLS",
    name: "PostgreSQL Row-Level Security Tenancy",
    category: "tenancy",
    description: "Multi-tenant data isolation enforced via database row-level security policies.",
    status: "enforced",
  },
  tokenLeastPrivilege: {
    id: "tokenLeastPrivilege",
    name: "API Token Least Privilege Scopes",
    category: "auth",
    description: "Token generation requires explicit non-empty scopes.",
    status: "enforced",
  },
};
