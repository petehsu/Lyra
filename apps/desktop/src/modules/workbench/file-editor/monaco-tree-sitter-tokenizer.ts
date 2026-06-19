import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

class EmptyTokenizerState implements Monaco.languages.IState {
  clone(): Monaco.languages.IState {
    return this;
  }

  equals(other: Monaco.languages.IState): boolean {
    return other instanceof EmptyTokenizerState;
  }
}

const EMPTY_TOKENIZER_STATE = new EmptyTokenizerState();

const createEmptyTokenizer = (): Monaco.languages.TokensProvider => ({
  getInitialState: () => EMPTY_TOKENIZER_STATE,
  tokenize: (_line, state) => ({
    endState: state,
    tokens: [{ startIndex: 0, scopes: "source" }]
  })
});

const registerLanguageIfNeeded = (
  monaco: typeof Monaco,
  id: string,
  extensions: readonly string[],
  aliases: readonly string[]
): void => {
  if (monaco.languages.getLanguages().some((entry) => entry.id === id)) {
    return;
  }
  monaco.languages.register({
    id,
    extensions: [...extensions],
    aliases: [...aliases]
  });
};

const TREE_SITTER_TOKENIZER_LANGUAGES = [
  { id: "rust", extensions: [".rs"], aliases: ["Rust", "rust"] },
  { id: "python", extensions: [".py"], aliases: ["Python", "python"] },
  { id: "typescript", extensions: [".ts", ".tsx"], aliases: ["TypeScript", "typescript", "ts"] },
  { id: "javascript", extensions: [".js", ".jsx"], aliases: ["JavaScript", "javascript", "js"] },
  { id: "json", extensions: [".json"], aliases: ["JSON", "json"] }
] as const;

let installed = false;

export const installMonacoTreeSitterTokenizers = (monaco: typeof Monaco): void => {
  if (installed) {
    return;
  }
  installed = true;

  const emptyTokenizer = createEmptyTokenizer();
  for (const language of TREE_SITTER_TOKENIZER_LANGUAGES) {
    registerLanguageIfNeeded(monaco, language.id, language.extensions, language.aliases);
    monaco.languages.setTokensProvider(language.id, emptyTokenizer);
  }
};