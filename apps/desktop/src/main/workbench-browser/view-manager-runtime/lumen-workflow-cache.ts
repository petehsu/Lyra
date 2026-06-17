import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  WorkbenchBrowserAgentInteraction,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserWorkflowCacheMode
} from "../types";
import type { WorkflowElementIdentity } from "./agent-element-matcher";

export type { WorkflowElementIdentity };

export type WorkflowCacheStep = {
  readonly targetRef: string;
  readonly interaction: WorkbenchBrowserAgentInteraction;
  readonly label?: string;
  readonly role?: string;
  readonly optionLabel?: string;
  readonly selectValue?: string;
  readonly identity?: WorkflowElementIdentity;
};

export type WorkflowCacheEntry = {
  readonly version: 1 | 2;
  readonly workflowId: string;
  readonly normalizedUrl: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly variableKeys: readonly string[];
  readonly steps: readonly WorkflowCacheStep[];
  readonly storedAt: string;
};

const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let workflowCacheRootOverride: string | null = null;

export const setWorkflowCacheRootForTests = (root: string | null): void => {
  workflowCacheRootOverride = root;
};

const workflowDir = (): string =>
  workflowCacheRootOverride ?? join(homedir(), ".lyra", "browser-workflows");

export const normalizeUrlForWorkflowCache = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
};

const workflowPath = (workflowId: string): string =>
  join(workflowDir(), `${createHash("sha256").update(workflowId.trim()).digest("hex")}.json`);

const readEntry = (workflowId: string): WorkflowCacheEntry | null => {
  const path = workflowPath(workflowId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WorkflowCacheEntry>;
    if (
      (parsed.version !== 1 && parsed.version !== 2)
      || typeof parsed.workflowId !== "string"
      || !Array.isArray(parsed.steps)
    ) {
      return null;
    }
    const storedAt = typeof parsed.storedAt === "string" ? Date.parse(parsed.storedAt) : Number.NaN;
    if (!Number.isFinite(storedAt) || Date.now() - storedAt > ENTRY_TTL_MS) {
      unlinkSync(path);
      return null;
    }
    return parsed as WorkflowCacheEntry;
  } catch {
    return null;
  }
};

export const invalidateWorkflowCache = (workflowId: string): void => {
  const path = workflowPath(workflowId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export const detectWorkflowVariableKey = (request: {
  readonly interaction: WorkflowCacheStep["interaction"];
  readonly label?: string;
  readonly role?: string;
  readonly typedValue?: string;
  readonly inputType?: string;
}): string | undefined => {
  if (request.interaction !== "type" && request.interaction !== "select") {
    return undefined;
  }
  const label = (request.label ?? "").toLowerCase();
  const inputType = (request.inputType ?? "").toLowerCase();
  if (inputType === "password" || label.includes("password")) {
    return "password";
  }
  if (label.includes("username") || label.includes("user name") || inputType === "username") {
    return "username";
  }
  if (label.includes("email") || inputType === "email") {
    return "email";
  }
  const typedValue = request.typedValue?.trim() ?? "";
  if (typedValue.length > 0) {
    if (EMAIL_PATTERN.test(typedValue)) {
      return "email";
    }
    if (DATE_PATTERN.test(typedValue)) {
      return "date";
    }
  }
  return undefined;
};

export const appendWorkflowCacheStep = (
  workflowId: string,
  context: {
    readonly normalizedUrl: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly variableKeys?: readonly string[];
  },
  step: WorkflowCacheStep
): void => {
  mkdirSync(workflowDir(), { recursive: true });
  const existing = readEntry(workflowId);
  const detectedKey = detectWorkflowVariableKey({
    interaction: step.interaction,
    label: step.label,
    role: step.role,
    inputType: step.identity?.selectorPreview.includes("[type=\"password\"]") === true
      ? "password"
      : step.identity?.selectorPreview.includes("[type=\"email\"]") === true
        ? "email"
        : undefined
  });
  const variableKeys = [
    ...(context.variableKeys ?? existing?.variableKeys ?? []),
    ...(detectedKey === undefined ? [] : [detectedKey])
  ];
  const entry: WorkflowCacheEntry = {
    version: 2,
    workflowId,
    normalizedUrl: context.normalizedUrl,
    targetMode: context.targetMode,
    variableKeys: [...new Set(variableKeys)].sort(),
    steps: [...(existing?.steps ?? []), step],
    storedAt: new Date().toISOString()
  };
  writeFileSync(workflowPath(workflowId), `${JSON.stringify(entry, null, 2)}\n`);
};

export const loadWorkflowCacheForReplay = (
  workflowId: string,
  context: {
    readonly normalizedUrl: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
  }
): { readonly mode: "miss"; readonly reason: string } | { readonly mode: "hit"; readonly entry: WorkflowCacheEntry } => {
  const entry = readEntry(workflowId);
  if (entry === null) {
    return { mode: "miss", reason: "entry_not_found" };
  }
  if (entry.normalizedUrl !== context.normalizedUrl) {
    invalidateWorkflowCache(workflowId);
    return { mode: "miss", reason: "url_changed" };
  }
  if (entry.targetMode !== context.targetMode) {
    invalidateWorkflowCache(workflowId);
    return { mode: "miss", reason: "target_mode_changed" };
  }
  if (entry.steps.length === 0) {
    invalidateWorkflowCache(workflowId);
    return { mode: "miss", reason: "empty_steps" };
  }
  return { mode: "hit", entry };
};

export const normalizeWorkflowCacheMode = (value: unknown): WorkbenchBrowserWorkflowCacheMode => {
  if (value === "record" || value === "replay") {
    return value;
  }
  return "off";
};