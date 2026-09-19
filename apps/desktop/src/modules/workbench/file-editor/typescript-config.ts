export const isTypeScriptConfigPath = (filePath: string): boolean => {
  const base = (filePath.replaceAll("\\", "/").split("/").pop() ?? "").toLowerCase();
  return base === "tsconfig.json"
    || base === "jsconfig.json"
    || /^tsconfig\.[^/]+\.json$/u.test(base);
};

export const literalIncludeFilesFromTsconfig = (content: string): readonly string[] => {
  try {
    const parsed = JSON.parse(content) as { readonly include?: unknown };
    if (Array.isArray(parsed.include) === false) {
      return [];
    }
    return parsed.include.filter((entry): entry is string =>
      typeof entry === "string"
      && entry.trim().length > 0
      && entry.includes("*") === false
      && entry.includes("?") === false
    );
  } catch {
    return [];
  }
};
