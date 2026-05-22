/** @type {import('next').NextConfig} */
const base = process.env.GH_PAGES_BASE ?? "";

const nextConfig = {
  output: "export",
  basePath: base,
  assetPrefix: base,
  trailingSlash: true,
  images: { unoptimized: true },
  typedRoutes: true,
  devIndicators: false,
  // Exposed to client bundle so raw <img src=...> can be prefixed correctly
  // when hosted under /applied_finance/ on GitHub Pages (Next only auto-
  // prefixes <Link>, <Image>, and metadata icons — not raw <img>).
  env: {
    NEXT_PUBLIC_BASE_PATH: base,
  },
};

export default nextConfig;
