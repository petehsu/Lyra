// ponytail: all monaco imports are dynamic — 0 KB until loadMonacoRuntime() is called.
// Rich JSON/CSS/HTML/TS contributions plus monarch grammars load with the editor.
// Upgrade path: extra TextMate/tree-sitter backends are a new dependency; monarch covers the VS Code web set.

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
      import("monaco-editor/esm/vs/basic-languages/monaco.contribution")
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