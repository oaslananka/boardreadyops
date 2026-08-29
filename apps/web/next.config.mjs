import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "header", key: "accept", value: "(.*)text/markdown(.*)" }],
          destination: "/index.md",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    const noindex = { key: "X-Robots-Tag", value: "noindex, nofollow" };
    return [
      { source: "/", headers: [{ key: "Link", value: '</llms.txt>; rel="describedby"' }] },
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

export default nextConfig;
