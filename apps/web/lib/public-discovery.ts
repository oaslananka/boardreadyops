export const PUBLIC_SITE_ORIGIN = "https://boardreadyops.com" as const;
export const DOCS_ORIGIN = "https://docs.boardreadyops.com" as const;
export const PUBLIC_CONTENT_LAST_UPDATED = "2026-08-29" as const;
export const PUBLIC_HTML_PAGES = [{ path: "/", markdownPath: "/index.md" }] as const;
export const PUBLIC_API_PATHS = ["/api/health/live", "/api/health/ready"] as const;

export const CURATED_DOC_LINKS = [
  { title: "Documentation", url: `${DOCS_ORIGIN}/`, note: "Canonical technical documentation." },
  { title: "Quickstart", url: `${DOCS_ORIGIN}/quickstart/`, note: "Install and run BoardReadyOps." },
  { title: "GitHub Action", url: `${DOCS_ORIGIN}/action/`, note: "GitHub Action usage and inputs." },
  { title: "Reports", url: `${DOCS_ORIGIN}/reports/html/`, note: "Release evidence and report formats." },
  {
    title: "GitHub App permissions",
    url: `${DOCS_ORIGIN}/security/github-app-permissions/`,
    note: "Least-privilege GitHub App model.",
  },
] as const;

export const GLOSSARY_TERMS = [
  ["DRC", "Design Rule Check: PCB layout constraints such as clearance and geometry."],
  ["ERC", "Electrical Rules Check: schematic connectivity and electrical consistency checks."],
  ["BOM", "Bill of Materials: the parts and sourcing data required to build the board."],
  ["Release evidence", "Versioned findings, outputs and checksums tied to the exact evaluated commit."],
  ["Manufacturing package", "Gerbers, drill, assembly and supporting outputs needed for fabrication."],
  ["Check Run", "The GitHub-native status and evidence surface associated with an exact commit."],
] as const;
