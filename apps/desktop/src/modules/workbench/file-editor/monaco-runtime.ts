// ponytail: all monaco imports are dynamic — 0 KB until loadMonacoRuntime() is called.
// This keeps the renderer baseline low; monaco's 4 language contributions + 5 web workers
// only load when the user actually opens the file editor.
// Upgrade path: if more languages are needed, add them to the same dynamic import block.

type MonacoEnvironmentWindow = Window & {
  MonacoEnvironment?: {
    getWorker?: (_moduleId: string, label: string) => Worker;
  };
};

let monacoPromise: Promise<typeof import("monaco-editor/esm/vs/editor/editor.api")> | null = null;

export const loadMonacoRuntime = async (): Promise<typeof import("monaco-editor/esm/vs/editor/editor.api")> => {
  if (monacoPromise) return monacoPromise;

  monacoPromise = (async () => {
    const [
      editorWorker,
      jsonWorker,
      cssWorker,
      htmlWorker,
      tsWorker,
      Monaco,
    ] = await Promise.all([
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      import("monaco-editor/esm/vs/editor/editor.api"),
    ]);

    // Side-effect imports: register language contributions
    await Promise.all([
      import("monaco-editor/esm/vs/language/json/monaco.contribution"),
      import("monaco-editor/esm/vs/language/css/monaco.contribution"),
      import("monaco-editor/esm/vs/language/html/monaco.contribution"),
      import("monaco-editor/esm/vs/language/typescript/monaco.contribution"),
    ]);

    if (typeof window !== "undefined") {
      (window as MonacoEnvironmentWindow).MonacoEnvironment = {
        getWorker: (_moduleId, label) => {
          if (label === "json") return new jsonWorker.default();
          if (label === "css" || label === "scss" || label === "less") return new cssWorker.default();
          if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker.default();
          if (label === "typescript" || label === "javascript") return new tsWorker.default();
          return new editorWorker.default();
        }
      };
    }

    return Monaco;
  })();

  return monacoPromise;
};