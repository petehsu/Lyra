import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode
} from "react";

import { getBuiltInTaskCardRenderer } from "./renderers";
import type { AiTaskCardRenderer } from "./types";

export type AiTaskCardRegistryStore = {
  readonly register: (kind: string, renderer: AiTaskCardRenderer) => void;
  readonly unregister: (kind: string) => void;
  readonly resolve: (kind: string) => AiTaskCardRenderer;
  readonly reset: () => void;
};

export const createTaskCardRegistryStore = (): AiTaskCardRegistryStore => {
  const runtimeRendererRegistry = new Map<string, AiTaskCardRenderer>();

  const normalizeKind = (kind: string): string => kind.trim();

  return {
    register: (kind: string, renderer: AiTaskCardRenderer): void => {
      const normalizedKind = normalizeKind(kind);
      if (normalizedKind.length === 0) {
        return;
      }
      runtimeRendererRegistry.set(normalizedKind, renderer);
    },
    unregister: (kind: string): void => {
      const normalizedKind = normalizeKind(kind);
      if (normalizedKind.length === 0) {
        return;
      }
      runtimeRendererRegistry.delete(normalizedKind);
    },
    resolve: (kind: string): AiTaskCardRenderer => {
      const normalizedKind = normalizeKind(kind);
      return runtimeRendererRegistry.get(normalizedKind)
        ?? getBuiltInTaskCardRenderer(normalizedKind);
    },
    reset: (): void => {
      runtimeRendererRegistry.clear();
    }
  };
};

const TaskCardRegistryContext = createContext<AiTaskCardRegistryStore | null>(null);

export const AiTaskCardRegistryProvider = ({
  scopeKey,
  children
}: {
  readonly scopeKey: string;
  readonly children: ReactNode;
}) => {
  const store = useMemo(() => createTaskCardRegistryStore(), [scopeKey]);

  useEffect(() => () => {
    store.reset();
  }, [store]);

  return (
    <TaskCardRegistryContext.Provider value={store}>
      {children}
    </TaskCardRegistryContext.Provider>
  );
};

const useTaskCardRegistryStore = (): AiTaskCardRegistryStore => {
  const storeFromContext = useContext(TaskCardRegistryContext);
  const fallbackStoreRef = useRef<AiTaskCardRegistryStore | null>(null);

  if (storeFromContext !== null) {
    return storeFromContext;
  }

  if (fallbackStoreRef.current === null) {
    fallbackStoreRef.current = createTaskCardRegistryStore();
  }

  return fallbackStoreRef.current;
};

export const useTaskCardRegistry = (): AiTaskCardRegistryStore => useTaskCardRegistryStore();

export const useTaskCardRenderer = (kind: string): AiTaskCardRenderer =>
  useTaskCardRegistryStore().resolve(kind);

let deprecatedGlobalRegistryStore: AiTaskCardRegistryStore | null = null;

const getDeprecatedGlobalRegistryStore = (): AiTaskCardRegistryStore => {
  if (deprecatedGlobalRegistryStore === null) {
    deprecatedGlobalRegistryStore = createTaskCardRegistryStore();
  }
  return deprecatedGlobalRegistryStore;
};

/**
 * @deprecated Prefer `useTaskCardRegistry().register(...)` inside `AiTaskCardRegistryProvider`.
 */
export const registerTaskCardRenderer = (
  kind: string,
  renderer: AiTaskCardRenderer
): void => {
  getDeprecatedGlobalRegistryStore().register(kind, renderer);
};

/**
 * @deprecated Prefer `useTaskCardRegistry().unregister(...)` inside `AiTaskCardRegistryProvider`.
 */
export const unregisterTaskCardRenderer = (kind: string): void => {
  getDeprecatedGlobalRegistryStore().unregister(kind);
};

/**
 * @deprecated Prefer `useTaskCardRenderer(kind)` inside `AiTaskCardRegistryProvider`.
 */
export const resolveTaskCardRenderer = (kind: string): AiTaskCardRenderer =>
  getDeprecatedGlobalRegistryStore().resolve(kind);
