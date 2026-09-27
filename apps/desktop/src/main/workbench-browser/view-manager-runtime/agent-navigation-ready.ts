import type { WebContents } from "electron";

/** Subscribe before starting navigation, so fast commits cannot be missed. */
export const observeAgentNavigation = (contents: WebContents, timeoutMs: number, address: string) => {
  let finish!: (state: "ready" | "pending" | "failed") => void;
  const done = new Promise<"ready" | "pending" | "failed">(resolve => {
    let committed = false;
    // A newly materialized tab can still emit about:blank's dom-ready after
    // the requested load starts. Only a committed destination can be ready.
    const commit = (_event: unknown, url: string) => {
      if (url !== "about:blank" || address === "about:blank") committed = true;
    };
    const ready = () => { if (committed) finish("ready"); };
    const inPage = (_event: unknown, url: string, main: boolean) => {
      if (main && url === address) finish("ready");
    };
    const failed = (_event: unknown, code: number, _description: string, _url: string, main: boolean) => {
      if(main && code !== -3) finish("failed");
    };
    const destroyed = () => finish("failed");
    const timer = setTimeout(()=>finish("pending"),Math.max(100,Math.min(timeoutMs,8_000)));
    finish = state => {
      clearTimeout(timer);
      contents.removeListener("dom-ready",ready);
      contents.removeListener("did-navigate",commit);
      contents.removeListener("did-navigate-in-page",inPage);
      contents.removeListener("did-fail-load",failed);
      contents.removeListener("destroyed",destroyed);
      resolve(state);
    };
    contents.on("dom-ready",ready);
    contents.on("did-navigate",commit);
    contents.on("did-navigate-in-page",inPage);
    contents.on("did-fail-load",failed);
    contents.on("destroyed",destroyed);
  });
  return {done,cancel:()=>finish("failed")};
};
