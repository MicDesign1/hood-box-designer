/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully client-side app — export as static HTML/JS/CSS.
  // Cloudflare Pages serves the `out/` folder directly, no server runtime needed.
  output: "export",
  images: {
    unoptimized: true,
  },
  eslint: {
    // Lint via `npm run lint` — style warnings shouldn't block deploys.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
