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
  webpack: (config) => {
    // @techstark/opencv-js's emscripten glue references Node built-ins that
    // don't exist in the browser (it's only ever loaded lazily client-side,
    // see lib/paper-detection.ts) — tell webpack these are optional.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
