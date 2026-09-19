import { getDesktopApi } from "../shell/service";

export type HtmlPreviewPlan =
  | { readonly kind: "static" }
  | {
      readonly kind: "command";
      readonly cwd: string;
      readonly command: string;
      readonly url: string;
    };

const parentDirectory = (filePath: string): string | null => {
  const trimmed = filePath.replace(/[\\/]+$/u, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slash <= 0) {
    return null;
  }
  return trimmed.slice(0, slash);
};

const joinPath = (directory: string, name: string): string => {
  const separator = directory.includes("\\") && directory.includes("/") === false ? "\\" : "/";
  return `${directory}${separator}${name}`;
};

const startedCwds = new Set<string>();

const readText = async (path: string): Promise<string | null> => {
  const desktopApi = getDesktopApi();
  if (desktopApi?.files.readTextFile === undefined) {
    return null;
  }
  try {
    const result = await desktopApi.files.readTextFile({ path });
    return result.kind === "text" ? result.content : null;
  } catch {
    return null;
  }
};

export const fileExists = async (path: string): Promise<boolean> => {
  const desktopApi = getDesktopApi();
  if (desktopApi?.files.statFile === undefined) {
    return false;
  }
  try {
    const stat = await desktopApi.files.statFile({ path });
    return stat.exists && stat.isDirectory === false;
  } catch {
    return false;
  }
};

const commandForPackage = (
  cwd: string,
  packageJson: string,
  hasViteConfig: boolean
): HtmlPreviewPlan | null => {
  let parsed: {
    readonly scripts?: Record<string, string>;
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(packageJson) as typeof parsed;
  } catch {
    return null;
  }
  const deps = {
    ...(parsed.dependencies ?? {}),
    ...(parsed.devDependencies ?? {})
  };
  const scripts = parsed.scripts ?? {};
  const hasVite = hasViteConfig || "vite" in deps;
  const hasNext = "next" in deps;
  if (hasVite === false && hasNext === false && typeof scripts.dev !== "string") {
    return null;
  }
  const command = typeof scripts.dev === "string" && scripts.dev.length > 0
    ? "pnpm run dev"
    : hasNext
      ? "pnpm exec next dev"
      : "pnpm exec vite";
  return {
    kind: "command",
    cwd,
    command,
    url: hasNext ? "http://127.0.0.1:3000" : "http://127.0.0.1:5173"
  };
};

export const detectHtmlPreviewPlan = async (filePath: string): Promise<HtmlPreviewPlan> => {
  let cursor = parentDirectory(filePath);
  for (let depth = 0; depth < 8 && cursor !== null; depth += 1) {
    const packagePath = joinPath(cursor, "package.json");
    const packageJson = await readText(packagePath);
    if (packageJson !== null) {
      const hasViteConfig =
        await fileExists(joinPath(cursor, "vite.config.ts")) ||
        await fileExists(joinPath(cursor, "vite.config.js")) ||
        await fileExists(joinPath(cursor, "vite.config.mts")) ||
        await fileExists(joinPath(cursor, "vite.config.mjs"));
      const plan = commandForPackage(cursor, packageJson, hasViteConfig);
      if (plan !== null) {
        return plan;
      }
    }
    cursor = parentDirectory(cursor);
  }
  return { kind: "static" };
};

export const htmlPreviewPlanFromPackageJson = commandForPackage;

export const startHtmlPreviewCommand = async (plan: Extract<HtmlPreviewPlan, { kind: "command" }>): Promise<void> => {
  if (startedCwds.has(plan.cwd)) {
    return;
  }
  const desktopApi = getDesktopApi();
  if (desktopApi?.terminal.createSession === undefined) {
    return;
  }
  startedCwds.add(plan.cwd);
  try {
    await desktopApi.terminal.createSession({
      title: "HTML preview",
      cwd: plan.cwd,
      mode: "command",
      command: plan.command,
      persist: false,
      cols: 80,
      rows: 24,
      source: "system"
    });
  } catch {
    startedCwds.delete(plan.cwd);
  }
};
