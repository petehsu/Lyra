import { AsyncLocalStorage } from "node:async_hooks";

/** Carries task identity across host IPC dispatch without tying it to UI focus. */
export const browserAgentOperationContext = new AsyncLocalStorage<{sessionId:string;turnId?:string;signal?:AbortSignal}>();

const pending = new Map<string, Set<AbortController>>();
export const trackBrowserOperation = (turnId?: string) => {
  const controller = new AbortController();
  if (turnId) {
    const controllers = pending.get(turnId) ?? new Set<AbortController>();
    controllers.add(controller); pending.set(turnId, controllers);
  }
  return { controller, dispose: () => {
    if (!turnId) return;
    const controllers = pending.get(turnId); controllers?.delete(controller);
    if (!controllers?.size) pending.delete(turnId);
  } };
};
export const cancelBrowserOperations = (turnId: string): void => {
  for (const controller of pending.get(turnId) ?? []) controller.abort(new Error("Browser task ended"));
  pending.delete(turnId);
};
