export const scopeToHighlightClass = (scope: string): string => {
  const normalized = scope.toLowerCase();
  if (normalized.includes("comment")) {
    return "lyra-docs-hl-comment";
  }
  if (normalized.includes("string")) {
    return "lyra-docs-hl-string";
  }
  if (
    normalized.includes("number")
    || normalized.includes("integer")
    || normalized.includes("float")
    || normalized.includes("constant")
    || normalized.includes("boolean")
  ) {
    return "lyra-docs-hl-number";
  }
  if (normalized.includes("keyword") || normalized.includes("operator")) {
    return "lyra-docs-hl-keyword";
  }
  if (normalized.includes("function") || normalized.includes("method")) {
    return "lyra-docs-hl-function";
  }
  if (normalized.includes("type") || normalized.includes("class")) {
    return "lyra-docs-hl-type";
  }
  if (
    normalized.includes("property")
    || normalized.includes("field")
    || normalized.includes("attribute")
  ) {
    return "lyra-docs-hl-property";
  }
  if (normalized.includes("variable") || normalized.includes("parameter")) {
    return "lyra-docs-hl-variable";
  }
  return "lyra-docs-hl-default";
};