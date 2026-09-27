import { AsyncLocalStorage } from "node:async_hooks";

/** Carries task identity across host IPC dispatch without tying it to UI focus. */
export const browserAgentOperationContext = new AsyncLocalStorage<{sessionId:string;turnId?:string}>();
