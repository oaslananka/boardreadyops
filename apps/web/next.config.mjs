import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    const noindex = { key: "X-Robots-Tag", value: "noindex, nofollow" };
    return [
      ...[
        "/setup",
        "/dashboard",
        "/work",
        "/evidence",
        "/insights",
        "/policies",
        "/repositories/:path*",
        "/reviews/:path*",
        "/runs/:path*",
        "/settings/:path*",
      ].map((source) => ({ source, headers: [noindex] })),
    ];
  },
  transpilePackages: [
    "@boardreadyops/cloud-core",
    "@boardreadyops/contracts",
    "@boardreadyops/db",
    "@octokit/auth-app",
  ],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

// Source map upload only runs when all three are configured. Deliberately
// requires SENTRY_AUTH_TOKEN too, not just org+project: an org:ci-scoped
// token (the kind used elsewhere in this deployment for release tracking)
// can't authenticate this upload, which needs project:releases. Rather than
// let a partially-configured deploy hit an upload error mid-build, this
// stays a no-op build until an org+project+auth-token set that actually
// works together is provided.
const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();

export default sentryOrg && sentryProject && sentryAuthToken
  ? withSentryConfig(nextConfig, {
      org: sentryOrg,
      project: sentryProject,
      authToken: sentryAuthToken,
      silent: !process.env.CI,
      widenClientFileUpload: false,
      disableLogger: true,
      telemetry: false,
    })
  : nextConfig;
