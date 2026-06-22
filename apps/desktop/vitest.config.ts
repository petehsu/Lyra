import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const reactAlias = {
  react: resolve(__dirname, "node_modules/react"),
  "react-dom": resolve(__dirname, "node_modules/react-dom"),
  "react/jsx-runtime": resolve(__dirname, "node_modules/react/jsx-runtime.js"),
  "react/jsx-dev-runtime": resolve(__dirname, "node_modules/react/jsx-dev-runtime.js")
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      ...reactAlias,
      "@lyra/browser-automation": resolve(__dirname, "../../services/browser-automation/src/index.ts"),
      "@renderer": resolve(__dirname, "src/renderer"),
      "@workbench": resolve(__dirname, "src/modules/workbench")
    },
    dedupe: ["react", "react-dom"]
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [resolve(__dirname, "src/renderer/test/setup.ts")],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "../../services/browser-automation/src/**/*.test.ts"
    ]
  }
});
