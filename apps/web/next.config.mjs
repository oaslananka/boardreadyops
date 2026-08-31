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

// Source map upload only runs when the operator has configured a Sentry
// project (SENTRY_ORG + SENTRY_PROJECT); otherwise the build is untouched.
const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();

export default sentryOrg && sentryProject
  ? withSentryConfig(nextConfig, {
      org: sentryOrg,
      project: sentryProject,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: false,
      disableLogger: true,
      telemetry: false,
    })
  : nextConfig;
