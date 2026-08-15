/// <reference path="../../../apps/desktop/src/renderer/lyra-desktop.d.ts" />
/// <reference path="../../../node_modules/.pnpm/@webgpu+types@0.1.71/node_modules/@webgpu/types/dist/index.d.ts" />

declare module "*.css";
declare module "*.scss";
declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly LYRA_PSEUDO_LOCALE?: string;
  readonly VITE_LYRA_DOCS_ENTRY_ADDRESS?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
