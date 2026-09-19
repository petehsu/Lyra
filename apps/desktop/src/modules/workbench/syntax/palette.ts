/**
 * Shared syntax token palette. Monaco (editor) and Shiki (markdown / diffs)
 * both read these hexes so chat, git, and the file editor paint the same
 * grammar colors. CSS `--lyra-syntax-*` in material.scss must stay in sync.
 */

export type SyntaxPalette = {
  readonly comment: string;
  readonly string: string;
  readonly number: string;
  readonly keyword: string;
  readonly operator: string;
  readonly function: string;
  readonly type: string;
  readonly variable: string;
  readonly parameter: string;
  readonly tag: string;
};

export const LYRA_SYNTAX_DARK: SyntaxPalette = {
  comment: "#6b7280",
  string: "#a3d4a0",
  number: "#d19a66",
  keyword: "#c678dd",
  operator: "#56b6c2",
  function: "#61afef",
  type: "#61afef",
  variable: "#e06c75",
  parameter: "#d5d7de",
  tag: "#e06c75"
};

export const LYRA_SYNTAX_LIGHT: SyntaxPalette = {
  comment: "#6a737d",
  string: "#032f62",
  number: "#005cc5",
  keyword: "#d73a49",
  operator: "#d73a49",
  function: "#6f42c1",
  type: "#005cc5",
  variable: "#e36209",
  parameter: "#24292e",
  tag: "#22863a"
};

export const syntaxHex = (value: string): string => value.replace(/^#/u, "");
