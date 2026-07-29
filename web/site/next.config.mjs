import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(siteRoot, "../.."),
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: path.resolve(siteRoot, "../..")
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.lyra.ltd" }],
        destination: "https://lyra.ltd/:path*",
        permanent: true
      },
      { source: "/terms", destination: "/legal/terms", permanent: true },
      { source: "/privacy", destination: "/legal/privacy", permanent: true },
      {
        source: "/docs",
        has: [
          {
            type: "host",
            value: "lyra-site.x13102306563.workers.dev"
          },
          {
            type: "query",
            key: "locale",
            value: "(?<docsLocale>en-US|zh-CN)"
          }
        ],
        destination:
          "https://lyra-docs.x13102306563.workers.dev/:docsLocale/docs",
        permanent: false
      },
      {
        source: "/docs",
        has: [
          {
            type: "host",
            value: "lyra-site.x13102306563.workers.dev"
          }
        ],
        destination:
          "https://lyra-docs.x13102306563.workers.dev/docs",
        permanent: false
      },
      {
        source: "/docs/:path*",
        has: [
          {
            type: "host",
            value: "lyra-site.x13102306563.workers.dev"
          }
        ],
        destination:
          "https://lyra-docs.x13102306563.workers.dev/docs/:path*",
        permanent: false
      },
      {
        source: "/contracts/:path*",
        has: [
          {
            type: "host",
            value: "lyra-site.x13102306563.workers.dev"
          }
        ],
        destination:
          "https://lyra-docs.x13102306563.workers.dev/contracts/:path*",
        permanent: false
      },
      {
        source: "/examples/:path*",
        has: [
          {
            type: "host",
            value: "lyra-site.x13102306563.workers.dev"
          }
        ],
        destination:
          "https://lyra-docs.x13102306563.workers.dev/examples/:path*",
        permanent: false
      },
      {
        source: "/docs",
        has: [
          {
            type: "query",
            key: "locale",
            value: "(?<docsLocale>en-US|zh-CN)"
          }
        ],
        destination: "https://docs.lyra.ltd/:docsLocale/docs",
        permanent: true
      },
      {
        source: "/docs",
        destination: "https://docs.lyra.ltd/docs",
        permanent: true
      },
      {
        source: "/docs/:path*",
        destination: "https://docs.lyra.ltd/docs/:path*",
        permanent: true
      },
      {
        source: "/contracts/:path*",
        destination: "https://docs.lyra.ltd/contracts/:path*",
        permanent: true
      },
      {
        source: "/examples/:path*",
        destination: "https://docs.lyra.ltd/examples/:path*",
        permanent: true
      }
    ];
  }
};

export default config;
