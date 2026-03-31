import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";

type MonacoEnvironmentWindow = Window & {
  MonacoEnvironment?: {
    getWorker?: (_moduleId: string, label: string) => Worker;
  };
};

let configured = false;

const ensureMonacoEnvironment = (): void => {
  if (configured || typeof window === "undefined") {
    return;
  }
  configured = true;

  (window as MonacoEnvironmentWindow).MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === "json") {
        return new jsonWorker();
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }
      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }
      return new editorWorker();
    }
  };
};

export const loadMonacoRuntime = async (): Promise<typeof Monaco> => {
  ensureMonacoEnvironment();
  return Monaco;
};
