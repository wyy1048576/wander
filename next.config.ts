import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Classic rendering model: pages are client-driven and poll route handlers,
  // so the Cache Components model adds nothing here and complicates DB access.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
