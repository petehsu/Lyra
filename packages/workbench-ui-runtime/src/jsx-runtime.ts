import { requireFirstPartyUiRuntime } from "./runtime";

const runtime = requireFirstPartyUiRuntime().jsxRuntime;

export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
