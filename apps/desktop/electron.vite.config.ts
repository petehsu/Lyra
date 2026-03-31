import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const projectRoot = __dirname;
const DEFAULT_RENDERER_PORT = 5173;

const resolveRendererPort = (): number => {
  const fromEnv = Number.parseInt(process.env.LYRA_RENDERER_PORT ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RENDERER_PORT;
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      outDir: "out/main",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      outDir: "out/preload",
      rollupOptions: {
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
      port: resolveRendererPort(),
      strictPort: false
    },
    resolve: {
      alias: {
        "@renderer": resolve(projectRoot, "src/renderer"),
        "@workbench": resolve(projectRoot, "src/modules/workbench")
      }
    },
    build: {
      outDir: resolve(projectRoot, "out/renderer"),
      emptyOutDir: true
    }
  }
});
