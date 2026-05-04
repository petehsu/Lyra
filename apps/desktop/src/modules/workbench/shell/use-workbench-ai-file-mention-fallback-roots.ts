import { useMemo } from "react";

type WorkbenchAiFileMentionFallbackRootsParams = {
  readonly currentPath: string | undefined;
  readonly tabs: readonly {
    readonly filePath?: string;
  }[];
};

export const useWorkbenchAiFileMentionFallbackRoots = ({
  currentPath,
  tabs
}: WorkbenchAiFileMentionFallbackRootsParams): readonly string[] =>
  useMemo(() => {
    const trimmedCurrentPath = currentPath?.trim();
    const roots = [
      trimmedCurrentPath === undefined || trimmedCurrentPath.length === 0 ? null : trimmedCurrentPath,
      ...tabs.map((tab) => {
        const filePath = tab.filePath?.trim();
        if (filePath === undefined || filePath.length === 0) {
          return null;
        }
        const normalized = filePath.replace(/\\/gu, "/");
        const separatorIndex = normalized.lastIndexOf("/");
        return separatorIndex <= 0 ? null : normalized.slice(0, separatorIndex);
      })
    ].filter((root): root is string => root !== null);
    return roots.filter((root, index, values) => values.indexOf(root) === index);
  }, [currentPath, tabs]);
