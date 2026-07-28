import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ["@lyra/markdown-render"],
  async redirects() {
    return [
      {
        source: "/docs/quickstart",
        destination: "/docs/getting-started",
        permanent: true
      },
      {
        source: "/docs/architecture",
        destination: "/docs/product-overview",
        permanent: true
      },
      {
        source: "/docs/lcp",
        destination: "/docs/developers/software-capabilities",
        permanent: true
      },
      {
        source: "/docs/topbar",
        destination: "/docs/workbench",
        permanent: true
      },
      {
        source: "/docs/workspace-tabs",
        destination: "/docs/workbench",
        permanent: true
      },
      {
        source: "/docs/search-home",
        destination: "/docs/workbench",
        permanent: true
      },
      {
        source: "/docs/file-manager",
        destination: "/docs/workbench",
        permanent: true
      },
      {
        source: "/docs/file-editor",
        destination: "/docs/workbench",
        permanent: true
      },
      {
        source: "/docs/linux-compat",
        destination: "/docs/linux",
        permanent: true
      }
    ];
  }
};

export default withMDX(config);
