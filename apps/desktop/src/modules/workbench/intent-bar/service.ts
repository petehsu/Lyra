import type { WorkbenchCommand } from "../shell/types";

const URL_PATTERN = /^https?:\/\//i;
const SHELL_PATTERN = /^>/;
const FILE_PATTERN = /^(~\/|\.\/|\.\.\/|\/|[a-zA-Z]:\\)/;

export const parseWorkbenchCommand = (rawValue: string): WorkbenchCommand => {
  const value = rawValue.trim();

  if (SHELL_PATTERN.test(value)) {
    return {
      kind: "command",
      value: value.slice(1).trim()
    };
  }

  if (URL_PATTERN.test(value)) {
    return {
      kind: "url",
      value
    };
  }

  if (FILE_PATTERN.test(value) || value.includes("/")) {
    return {
      kind: "file",
      value
    };
  }

  return {
    kind: "task",
    value
  };
};

export const createPlaceholderByPreset = (preset: "browser" | "ide"): string => {
  if (preset === "browser") {
    return "输入 URL、任务或 > 命令，例如 https://localhost:3000/checkout";
  }
  return "输入任务、文件路径或 > 命令，例如 修复 checkout 500 并补测试";
};
