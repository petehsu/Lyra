export type MonacoSyntaxHighlightKind =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "function"
  | "type"
  | "property"
  | "variable"
  | "default";

const HIGHLIGHT_CLASS_BY_KIND: Record<MonacoSyntaxHighlightKind, string> = {
  comment: "lyra-monaco-ts-comment",
  string: "lyra-monaco-ts-string",
  number: "lyra-monaco-ts-number",
  keyword: "lyra-monaco-ts-keyword",
  function: "lyra-monaco-ts-function",
  type: "lyra-monaco-ts-type",
  property: "lyra-monaco-ts-property",
  variable: "lyra-monaco-ts-variable",
  default: "lyra-monaco-ts-default"
};

export const scopeToHighlightKind = (scope: string): MonacoSyntaxHighlightKind => {
  const normalized = scope.toLowerCase();
  if (normalized.includes("comment")) {
    return "comment";
  }
  if (normalized.includes("string")) {
    return "string";
  }
  if (
    normalized.includes("number")
    || normalized.includes("integer")
    || normalized.includes("float")
    || normalized.includes("constant")
    || normalized.includes("boolean")
  ) {
    return "number";
  }
  if (normalized.includes("keyword") || normalized.includes("operator")) {
    return "keyword";
  }
  if (normalized.includes("function") || normalized.includes("method")) {
    return "function";
  }
  if (normalized.includes("type") || normalized.includes("class")) {
    return "type";
  }
  if (
    normalized.includes("property")
    || normalized.includes("field")
    || normalized.includes("attribute")
  ) {
    return "property";
  }
  if (normalized.includes("variable") || normalized.includes("parameter")) {
    return "variable";
  }
  return "default";
};

export const scopeToInlineClassName = (scope: string): string =>
  HIGHLIGHT_CLASS_BY_KIND[scopeToHighlightKind(scope)];