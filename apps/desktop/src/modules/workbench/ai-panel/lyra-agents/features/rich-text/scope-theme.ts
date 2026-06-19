export const scopeToHighlightClass = (scope: string): string => {
  const normalized = scope.toLowerCase();
  if (normalized.includes("comment")) {
    return "hljs-comment";
  }
  if (normalized.includes("string")) {
    return "hljs-string";
  }
  if (
    normalized.includes("number")
    || normalized.includes("integer")
    || normalized.includes("float")
    || normalized.includes("constant")
    || normalized.includes("boolean")
  ) {
    return "hljs-number";
  }
  if (normalized.includes("keyword") || normalized.includes("operator")) {
    return "hljs-keyword";
  }
  if (normalized.includes("function") || normalized.includes("method")) {
    return "hljs-title function_";
  }
  if (normalized.includes("type") || normalized.includes("class")) {
    return "hljs-type";
  }
  if (
    normalized.includes("property")
    || normalized.includes("field")
    || normalized.includes("attribute")
  ) {
    return "hljs-attr";
  }
  if (normalized.includes("variable") || normalized.includes("parameter")) {
    return "hljs-variable";
  }
  return "hljs";
};