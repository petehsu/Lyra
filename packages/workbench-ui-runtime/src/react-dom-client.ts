import { requireFirstPartyUiRuntime } from "./runtime";

const runtime = requireFirstPartyUiRuntime().reactDomClient;

export const createRoot = runtime.createRoot;
export const hydrateRoot = runtime.hydrateRoot;
