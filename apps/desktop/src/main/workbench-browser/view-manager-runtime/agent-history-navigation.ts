import type { WebContents } from "electron";
import { browserKeyEvents } from "./agent-keyboard";

export const browserHistoryDirection = (key: string): "back" | "forward" | undefined => {
  const event = browserKeyEvents(key)[0]!;
  const modifiers = event.modifiers ?? [];
  if (modifiers.length !== 1) return;
  if (modifiers[0] === "alt" && event.keyCode === "Left" || modifiers[0] === "meta" && event.keyCode === "[") return "back";
  if (modifiers[0] === "alt" && event.keyCode === "Right" || modifiers[0] === "meta" && event.keyCode === "]") return "forward";
};

/** Browser chrome shortcuts are history operations, not page keyboard events. */
export const navigateAgentHistory = async (contents: WebContents, direction: "back" | "forward", timeoutMs = 4_000) => {
  const history = contents.navigationHistory;
  if (!(direction === "back" ? history.canGoBack() : history.canGoForward())) {
    return {ok:false,error:{kind:"history_unavailable",message:`No ${direction} entry exists for this tab. No navigation was performed.`}};
  }
  return await new Promise<{ok:boolean; url?:string; status?:string; error?:{kind:string;message:string}}>(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (status: string, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener("did-navigate", navigated);
      contents.removeListener("did-navigate-in-page", inPage);
      contents.removeListener("did-fail-load", failed);
      contents.removeListener("destroyed", destroyed);
      resolve({ok:!error,status,...(contents.isDestroyed()?{}:{url:contents.getURL()}),
        ...(error?{error:{kind:"history_navigation_failed",message:error}}:{})});
    };
    const navigated = () => finish("navigated");
    const destroyed = () => finish("failed", "The tab closed before history navigation completed.");
    const inPage = (_event: unknown, _url: string, main: boolean) => {if(main) navigated();};
    const failed = (_event: unknown, code: number, description: string, _url: string, main: boolean) => {
      if(main && code !== -3) finish("failed",description);
    };
    contents.on("did-navigate",navigated);
    contents.on("did-navigate-in-page",inPage);
    contents.on("did-fail-load",failed);
    contents.on("destroyed",destroyed);
    timer = setTimeout(()=>finish("pending", "History navigation was dispatched but not confirmed. Read this tab to check progress; do not repeat the navigation."),Math.max(100,Math.min(4_000,timeoutMs)));
    try { if(direction === "back") history.goBack(); else history.goForward(); }
    catch(error) { finish("failed",String(error)); }
  });
};
