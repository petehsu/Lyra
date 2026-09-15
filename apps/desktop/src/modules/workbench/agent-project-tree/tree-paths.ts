export const parentDirectoryOf = (filePath: string): string => {
  const trimmed = filePath.replace(/[\\/]+$/u, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (separatorIndex <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, separatorIndex);
};

export const joinPath = (parentPath: string, name: string): string => {
  const trimmed = parentPath.replace(/[\\/]+$/u, "");
  const separator = trimmed.includes("\\") && trimmed.includes("/") === false ? "\\" : "/";
  return `${trimmed}${separator}${name}`;
};

export const relativeProjectPath = (rootPath: string, targetPath: string): string => {
  const root = rootPath.replace(/[\\/]+$/u, "").replace(/\\/g, "/");
  const target = targetPath.replace(/[\\/]+$/u, "").replace(/\\/g, "/");
  if (target === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (target.startsWith(prefix)) {
    return target.slice(prefix.length);
  }
  return targetPath;
};

export const createParentPath = (
  path: string,
  kind: "file" | "directory"
): string => (kind === "directory" ? path.replace(/[\\/]+$/u, "") : parentDirectoryOf(path));

export const isValidEntryName = (name: string): boolean => {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== "." &&
    trimmed !== ".." &&
    trimmed.includes("/") === false &&
    trimmed.includes("\\") === false
  );
};
