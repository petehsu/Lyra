import type {
  JsonValue,
  WorkbenchChromeContributionV1,
  WorkbenchChromeScopeV1,
  WorkbenchChromeSlotV1
} from "@lyra/app-runtime";
import {
  validateWorkbenchChromeContributionV1,
  validateWorkbenchChromeScopeV1,
  validateWorkbenchChromeSlotV1,
  workbenchChromeScopeKey
} from "@lyra/app-runtime";

export type WorkbenchChromeChangedPayload = {
  readonly scope: WorkbenchChromeScopeV1;
  readonly slot: WorkbenchChromeSlotV1;
  readonly scopeKey: string;
};

type StoredContribution = {
  readonly ownerId: string;
  readonly contribution: WorkbenchChromeContributionV1;
};

const entryKey = (scopeKey: string, slot: WorkbenchChromeSlotV1): string =>
  `${scopeKey}:${slot}`;

const mergeOrdered = <T extends { readonly order: number }>(items: readonly T[]): readonly T[] =>
  [...items].sort((left, right) => left.order - right.order || 0);

const contributionEquals = (
  left: WorkbenchChromeContributionV1,
  right: WorkbenchChromeContributionV1
): boolean => JSON.stringify(left) === JSON.stringify(right);

const mergeContributions = (
  entries: readonly WorkbenchChromeContributionV1[]
): WorkbenchChromeContributionV1 | null => {
  if (entries.length === 0) {
    return null;
  }
  const actions = mergeOrdered(entries.flatMap((entry) => entry.actions ?? []));
  const chips = mergeOrdered(entries.flatMap((entry) => entry.chips ?? []));
  const metaItems = mergeOrdered(entries.flatMap((entry) => entry.metaItems ?? []));
  const ariaLabel = [...entries].reverse().find((entry) => entry.ariaLabel !== undefined)?.ariaLabel;
  const navigation = [...entries].reverse().find((entry) => entry.navigation !== undefined)?.navigation;
  return {
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    ...(actions.length === 0 ? {} : { actions }),
    ...(chips.length === 0 ? {} : { chips }),
    ...(navigation === undefined ? {} : { navigation }),
    ...(metaItems.length === 0 ? {} : { metaItems })
  };
};

export type WorkbenchChromeBus = {
  readonly set: (input: {
    readonly scope: WorkbenchChromeScopeV1;
    readonly slot: WorkbenchChromeSlotV1;
    readonly ownerId: string;
    readonly contribution: WorkbenchChromeContributionV1;
  }) => void;
  readonly clear: (input: {
    readonly scope: WorkbenchChromeScopeV1;
    readonly slot: WorkbenchChromeSlotV1;
    readonly ownerId: string;
  }) => void;
  readonly clearOwner: (ownerId: string) => void;
  readonly clearWorkspaceTab: (tabId: string) => void;
  readonly clearAiSession: (sessionId: string) => void;
  readonly read: (
    scope: WorkbenchChromeScopeV1,
    slot: WorkbenchChromeSlotV1
  ) => WorkbenchChromeContributionV1 | null;
  readonly subscribe: (listener: (payload: WorkbenchChromeChangedPayload) => void) => () => void;
};

export const createWorkbenchChromeBus = (): WorkbenchChromeBus => {
  const byKey = new Map<string, Map<string, StoredContribution>>();
  const listeners = new Set<(payload: WorkbenchChromeChangedPayload) => void>();

  const notify = (
    scope: WorkbenchChromeScopeV1,
    slot: WorkbenchChromeSlotV1
  ): void => {
    const payload: WorkbenchChromeChangedPayload = {
      scope,
      slot,
      scopeKey: workbenchChromeScopeKey(scope)
    };
    for (const listener of listeners) {
      listener(payload);
    }
  };

  const readInternal = (
    scope: WorkbenchChromeScopeV1,
    slot: WorkbenchChromeSlotV1
  ): WorkbenchChromeContributionV1 | null => {
    const bucket = byKey.get(entryKey(workbenchChromeScopeKey(scope), slot));
    if (bucket === undefined || bucket.size === 0) {
      return null;
    }
    return mergeContributions([...bucket.values()].map(({ contribution }) => contribution));
  };

  const removeScopeKey = (scopeKey: string, scope: WorkbenchChromeScopeV1): void => {
    for (const slot of ["toolbarContext", "navigation", "composerMeta"] as const) {
      const key = entryKey(scopeKey, slot);
      if (byKey.delete(key)) {
        notify(scope, slot);
      }
    }
  };

  return {
    set: ({ scope, slot, ownerId, contribution }) => {
      if (!validateWorkbenchChromeScopeV1(scope)) {
        throw new Error("Invalid workbench chrome scope.");
      }
      if (!validateWorkbenchChromeSlotV1(slot)) {
        throw new Error("Invalid workbench chrome slot.");
      }
      if (!validateWorkbenchChromeContributionV1(contribution)) {
        throw new Error("Invalid workbench chrome contribution.");
      }
      const key = entryKey(workbenchChromeScopeKey(scope), slot);
      const bucket = byKey.get(key) ?? new Map<string, StoredContribution>();
      const previous = bucket.get(ownerId);
      if (previous !== undefined && contributionEquals(previous.contribution, contribution)) {
        return;
      }
      bucket.set(ownerId, { ownerId, contribution });
      byKey.set(key, bucket);
      notify(scope, slot);
    },
    clear: ({ scope, slot, ownerId }) => {
      const key = entryKey(workbenchChromeScopeKey(scope), slot);
      const bucket = byKey.get(key);
      if (bucket === undefined) {
        return;
      }
      bucket.delete(ownerId);
      if (bucket.size === 0) {
        byKey.delete(key);
      }
      notify(scope, slot);
    },
    clearOwner: (ownerId) => {
      for (const [key, bucket] of [...byKey.entries()]) {
        if (!bucket.has(ownerId)) {
          continue;
        }
        bucket.delete(ownerId);
        if (bucket.size === 0) {
          byKey.delete(key);
        }
        const slot = key.split(":").slice(-1)[0] as WorkbenchChromeSlotV1;
        const scopeKey = key.slice(0, -(slot.length + 1));
        if (scopeKey.startsWith("workspaceTab:")) {
          notify({ kind: "workspaceTab", tabId: scopeKey.slice("workspaceTab:".length) }, slot);
        } else if (scopeKey.startsWith("aiSession:")) {
          notify({ kind: "aiSession", sessionId: scopeKey.slice("aiSession:".length) }, slot);
        }
      }
    },
    clearWorkspaceTab: (tabId) => {
      removeScopeKey(`workspaceTab:${tabId}`, { kind: "workspaceTab", tabId });
    },
    clearAiSession: (sessionId) => {
      removeScopeKey(`aiSession:${sessionId}`, { kind: "aiSession", sessionId });
    },
    read: readInternal,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

export const workbenchChromeBus = createWorkbenchChromeBus();

const asRecord = (value: JsonValue): Readonly<Record<string, JsonValue>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Workbench chrome command input must be an object.");
  }
  return value as Readonly<Record<string, JsonValue>>;
};

export const handleWorkbenchChromeSetCommand = (value: JsonValue): JsonValue => {
  const input = asRecord(value);
  const scope = input.scope;
  const slot = input.slot;
  const ownerId = input.ownerId;
  const contribution = input.contribution;
  if (typeof ownerId !== "string" || ownerId.trim().length === 0) {
    throw new Error("Workbench chrome ownerId is required.");
  }
  if (!validateWorkbenchChromeScopeV1(scope)) {
    throw new Error("Invalid workbench chrome scope.");
  }
  if (!validateWorkbenchChromeSlotV1(slot)) {
    throw new Error("Invalid workbench chrome slot.");
  }
  if (!validateWorkbenchChromeContributionV1(contribution)) {
    throw new Error("Invalid workbench chrome contribution.");
  }
  workbenchChromeBus.set({
    scope,
    slot,
    ownerId: ownerId.trim(),
    contribution
  });
  return null;
};

export const handleWorkbenchChromeClearCommand = (value: JsonValue): JsonValue => {
  const input = asRecord(value);
  const scope = input.scope;
  const slot = input.slot;
  const ownerId = input.ownerId;
  if (typeof ownerId !== "string" || ownerId.trim().length === 0) {
    throw new Error("Workbench chrome ownerId is required.");
  }
  if (!validateWorkbenchChromeScopeV1(scope)) {
    throw new Error("Invalid workbench chrome scope.");
  }
  if (!validateWorkbenchChromeSlotV1(slot)) {
    throw new Error("Invalid workbench chrome slot.");
  }
  workbenchChromeBus.clear({
    scope,
    slot,
    ownerId: ownerId.trim()
  });
  return null;
};

export const handleWorkbenchChromeReadCommand = (value: JsonValue): JsonValue => {
  const input = asRecord(value);
  const scope = input.scope;
  const slot = input.slot;
  if (!validateWorkbenchChromeScopeV1(scope)) {
    throw new Error("Invalid workbench chrome scope.");
  }
  if (!validateWorkbenchChromeSlotV1(slot)) {
    throw new Error("Invalid workbench chrome slot.");
  }
  const contribution = workbenchChromeBus.read(scope, slot);
  return contribution === null ? null : (contribution as unknown as JsonValue);
};
