import { resolve } from "node:path";

import { defineConfig } from "vite";

const studioRoot = __dirname;
const repositoryRoot = resolve(studioRoot, "../..");
const desktopRoot = resolve(repositoryRoot, "apps/desktop");
const desktopSource = resolve(desktopRoot, "src");
const desktopNodeModules = resolve(desktopRoot, "node_modules");

export default defineConfig({
  root: studioRoot,
  plugins: [
    {
      name: "lyra-promo-browser-adapters",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          source === "./service" &&
          importer?.endsWith("/modules/workbench/state-storage/index.ts")
        ) {
          return resolve(studioRoot, "src/adapters/state-storage.ts");
        }
        return null;
      }
    }
  ],
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
    fs: {
      allow: [repositoryRoot]
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 5191,
    strictPort: true
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext"
    }
  },
  resolve: {
    alias: [
      {
        find: resolve(desktopSource, "modules/workbench/state-storage/service.ts"),
        replacement: resolve(studioRoot, "src/adapters/state-storage.ts")
      },
      { find: "@renderer", replacement: resolve(desktopSource, "renderer") },
      { find: "@workbench", replacement: resolve(desktopSource, "modules/workbench") },
      {
        find: "@lyra/browser-automation",
        replacement: resolve(repositoryRoot, "services/browser-automation/src/index.ts")
      },
      {
        find: "@lyra/markdown-render",
        replacement: resolve(repositoryRoot, "packages/markdown-render/src/index.ts")
      },
      {
        find: "@lyra/app-runtime",
        replacement: resolve(repositoryRoot, "packages/app-runtime/src/index.ts")
      },
      {
        find: "@lyra/workbench-ui-runtime",
        replacement: resolve(repositoryRoot, "packages/workbench-ui-runtime/src")
      },
      { find: "@fontsource", replacement: resolve(desktopNodeModules, "@fontsource") },
      {
        find: "@fontsource-variable",
        replacement: resolve(desktopNodeModules, "@fontsource-variable")
      },
      { find: "react", replacement: resolve(desktopNodeModules, "react") },
      { find: "react-dom", replacement: resolve(desktopNodeModules, "react-dom") }
    ],
    dedupe: ["react", "react-dom"]
  },
  build: {
    target: "esnext",
    outDir: resolve(studioRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true
  }
});
