import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const projectRoot = __dirname;
const DEFAULT_RENDERER_PORT = 5173;
const reactAlias = {
  react: resolve(projectRoot, "node_modules/react"),
  "react-dom": resolve(projectRoot, "node_modules/react-dom"),
  "react/jsx-runtime": resolve(projectRoot, "node_modules/react/jsx-runtime.js"),
  "react/jsx-dev-runtime": resolve(projectRoot, "node_modules/react/jsx-dev-runtime.js")
};
const sharedAliases = {
  ...reactAlias,
  "@renderer": resolve(projectRoot, "src/renderer"),
  "@workbench": resolve(projectRoot, "src/modules/workbench"),
  "@lyra/browser-automation": resolve(projectRoot, "../../services/browser-automation/src/index.ts"),
  "@lyra/markdown-render": resolve(projectRoot, "../../packages/markdown-render/src/index.ts"),
  "@lyra/plugin-sdk": resolve(projectRoot, "../../packages/plugin-sdk/src/index.ts")
};

const resolveRendererPort = (): number => {
  const fromEnv = Number.parseInt(process.env.LYRA_RENDERER_PORT ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RENDERER_PORT;
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAliases,
      dedupe: ["react", "react-dom"]
    },
    build: {
      sourcemap: true,
      outDir: "out/main",
      rollupOptions: {
        input: {
          index: resolve(projectRoot, "src/main/index.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAliases,
      dedupe: ["react", "react-dom"]
    },
    build: {
      sourcemap: true,
      outDir: "out/preload",
      rollupOptions: {
        input: {
          index: resolve(projectRoot, "src/preload/index.ts"),
          "browser-page-frame": resolve(projectRoot, "src/preload/browser-page-frame.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    root: resolve(projectRoot, "src/renderer"),
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: resolveRendererPort(),
      strictPort: true
    },
    optimizeDeps: {
      esbuildOptions: {
        target: "esnext"
      }
    },
    resolve: {
      alias: sharedAliases,
      dedupe: ["react", "react-dom"]
    },
    build: {
      target: "esnext",
      outDir: resolve(projectRoot, "out/renderer"),
      emptyOutDir: true
    }
  }
});
