import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { loadEnv } from "vite";

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
  "@lyra/app-runtime": resolve(projectRoot, "../../packages/app-runtime/src/index.ts")
};

const resolveRendererPort = (): number => {
  const fromEnv = Number.parseInt(process.env.LYRA_RENDERER_PORT ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RENDERER_PORT;
};

export default defineConfig({
  main: {
    envDir: projectRoot,
    plugins: [externalizeDepsPlugin({
      // Bundle the only non-Electron runtime dependencies used by Core main.
      // This keeps the signed Core payload independent from a wholesale
      // production node_modules tree.
      exclude: [
        "@lyra/app-runtime",
        "@supabase/supabase-js",
        "electron-updater",
        "jsqr",
        "@embedpdf/pdfium",
        "@genoffice/docx-engine",
        "@genoffice/font-metrics",
        "@genoffice/pdf2docx",
        "@genoffice/docx-headless",
        "@genoffice/i18n",
        "@genoffice/pptx-engine",
        "@genoffice/pptx-ops",
        "@genoffice/pptx-render",
        "@genoffice/pipelines",
        "bidi-js",
        "@genoffice/xlsx-dsl",
        "@genoffice/xlsx-gateway",
        "jszip",
        "fast-xml-parser",
        "utif2",
        "zod",
        "numfmt"
      ]
    })],
    define: Object.fromEntries(
      Object.entries(
        loadEnv(process.env.NODE_ENV ?? "production", projectRoot, "")
      ).filter(([key]) => key.startsWith("VITE_"))
        .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
    ),
    resolve: {
      alias: sharedAliases,
      dedupe: ["react", "react-dom"]
    },
    build: {
      // Core release components must not embed original TypeScript sources.
      // Development uses electron-vite's dev server and does not need
      // production bundle source maps.
      sourcemap: false,
      // electron-vite `build` nulls this. `dev --watch` keeps it so main
      // changes restart Electron without tearing down the renderer Vite server.
      watch: {
        exclude: ["**/src/renderer/**", "**/src/modules/workbench/**"]
      },
      outDir: "out/main",
      rollupOptions: {
        external: ["node:sqlite", "jsdom"],
        input: {
          index: resolve(projectRoot, "src/main/index.ts"),
          "shared-process": resolve(projectRoot, "src/main/shared-process/shared-process-main.ts"),
          "tsconfig-project-diagnostics": resolve(
            projectRoot,
            "src/main/lsp/tsconfig-project-diagnostics-worker.ts"
          )
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
      sourcemap: false,
      watch: {
        exclude: ["**/src/renderer/**", "**/src/modules/workbench/**"]
      },
      outDir: "out/preload",
      rollupOptions: {
        input: {
          index: resolve(projectRoot, "src/preload/index.ts"),
          "browser-page-frame": resolve(projectRoot, "src/preload/browser-page-frame.ts"),
          "third-party-app": resolve(projectRoot, "src/preload/third-party-app.ts")
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
      strictPort: true,
      hmr: {
        host: "127.0.0.1",
        protocol: "ws",
        overlay: true
      },
      watch: {
        ignored: ["**/native/**", "**/out/**", "**/target/**"]
      }
    },
    optimizeDeps: {
      exclude: [
        "@lyra/icons",
        "@lyra/icons/file-type",
        "@lyra/icons/brands",
        "@iconify-json/vscode-icons",
        "reicon-brands",
        "@silurus/ooxml"
      ],
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
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            monaco: ["monaco-editor"],
            mermaid: ["mermaid"],
          }
        }
      }
    }
  }
});
