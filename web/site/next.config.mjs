import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: path.resolve(siteRoot, "../..")
  },
  async redirects() {
    return [
      { source: "/terms", destination: "/legal/terms", permanent: true },
      { source: "/privacy", destination: "/legal/privacy", permanent: true }
    ];
  },
  async rewrites() {
    return [
      { source: "/legal", destination: "/legal/index.html" },
      { source: "/legal/terms", destination: "/legal/terms/index.html" },
      { source: "/legal/privacy", destination: "/legal/privacy/index.html" },
      { source: "/legal/licenses", destination: "/legal/licenses/index.html" }
    ];
  }
};

export default config;
