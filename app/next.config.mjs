/** @type {import('next').NextConfig} */
const base = process.env.GH_PAGES_BASE ?? "";

const nextConfig = {
  output: "export",
  basePath: base,
  assetPrefix: base,
  trailingSlash: true,
  images: { unoptimized: true },
  typedRoutes: true,
};

export default nextConfig;
