import { readFile } from "node:fs/promises";
import path from "node:path";

import { build } from "vite";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

const main = async (): Promise<void> => {
  const appRoot = process.cwd();
  const repoRoot = path.resolve(appRoot, "../..");
  const release = process.argv.includes("--release");
  const packageDocument = JSON.parse(
    await readFile(path.join(appRoot, "package.json"), "utf8")
  ) as { readonly private?: unknown; readonly version?: unknown };
  if (packageDocument.private !== true) {
    throw new Error("First-party application packages must remain private.");
  }
  if (
    typeof packageDocument.version !== "string"
    || !SEMVER_PATTERN.test(packageDocument.version)
  ) {
    throw new Error("First-party application package version must be SemVer.");
  }

  await build({
    root: appRoot,
    configFile: false,
    define: {
      __LYRA_APP_VERSION__: JSON.stringify(packageDocument.version)
    },
    resolve: {
      alias: [
        {
          find: /^react\/jsx-runtime$/u,
          replacement: path.join(repoRoot, "packages/workbench-ui-runtime/src/jsx-runtime.ts")
        },
        {
          find: /^react-dom\/client$/u,
          replacement: path.join(repoRoot, "packages/workbench-ui-runtime/src/react-dom-client.ts")
        },
        {
          find: /^react$/u,
          replacement: path.join(repoRoot, "packages/workbench-ui-runtime/src/react.ts")
        }
      ]
    },
    build: {
      target: "esnext",
      outDir: "dist",
      emptyOutDir: true,
      // Source maps retain the original TypeScript sources. Development
      // bundles keep them for diagnostics; signed release components do not.
      sourcemap: release ? false : true,
      lib: {
        entry: path.join(appRoot, "src/index.tsx"),
        formats: ["es"],
        fileName: () => "index.mjs"
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    }
  });
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
