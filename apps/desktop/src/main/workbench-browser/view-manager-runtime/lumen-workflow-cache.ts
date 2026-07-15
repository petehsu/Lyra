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
  readonly fieldType?: "password" | "username" | "email";
  readonly identity?: WorkflowElementIdentity;
};

export type WorkflowCacheEntry = {
  readonly version: 1 | 2 | 3;
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
      (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)
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

export const detectWorkflowVariableKey = (request: {
  readonly interaction: WorkflowCacheStep["interaction"];
  readonly inputType?: string;
  readonly autocompleteTokens?: readonly string[];
}): string | undefined => {
  if (request.interaction !== "type" && request.interaction !== "select") {
    return undefined;
  }
  const inputType = (request.inputType ?? "").toLowerCase();
  const autocomplete = new Set(request.autocompleteTokens ?? []);
  if (
    inputType === "password"
    || autocomplete.has("current-password")
    || autocomplete.has("new-password")
  ) {
    return "password";
  }
  if (autocomplete.has("username")) {
    return "username";
  }
  if (inputType === "email" || autocomplete.has("email")) {
    return "email";
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
  const detectedKey = step.fieldType;
  const variableKeys = [
    ...(context.variableKeys ?? existing?.variableKeys ?? []),
    ...(detectedKey === undefined ? [] : [detectedKey])
  ];
  const entry: WorkflowCacheEntry = {
    version: 3,
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
