const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@boardreadyops/cloud-core", "@boardreadyops/contracts"],
};

export default nextConfig;
