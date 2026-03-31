import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer"),
      "@workbench": resolve(__dirname, "src/modules/workbench")
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [resolve(__dirname, "src/renderer/test/setup.ts")],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});
