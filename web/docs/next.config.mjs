import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const docsRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: "export",
  turbopack: {
    root: path.resolve(docsRoot, "../..")
  },
  transpilePackages: ["@lyra/markdown-render"]
};

export default withMDX(config);
