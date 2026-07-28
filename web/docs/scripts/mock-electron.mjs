import { registerHooks } from "node:module";

const electronUrl = "lyra-docs-mock:electron";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron") {
      return { url: electronUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === electronUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export const BrowserWindow = { getAllWindows: () => [] };
          export const ipcMain = { handle: () => {}, removeHandler: () => {} };
        `
      };
    }
    return nextLoad(url, context);
  }
});
