import type {
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult
} from "../../../shared/desktop-bridge";
import {
  findSearchInPageMatches,
  hashStableString,
  normalizeAddress,
  normalizeString
} from "./normalizers";
import type {
  BrowserPageEntry,
  BrowserPageFindRevealResult,
  BrowserPageFindTarget
} from "./types";

type PageFindRuntimeHost = {
  readonly requireEntry: (tabId: string) => BrowserPageEntry;
  readonly getActiveOrFocusedTabId: () => string | null;
};

export const createPageFindRuntime = ({
  requireEntry,
  getActiveOrFocusedTabId
}: PageFindRuntimeHost) => {
  const clearSearchInPageOverlay = async (
    target: Pick<BrowserPageFindTarget, "webContents">
  ): Promise<void> => {
    try {
      target.webContents.stopFindInPage("clearSelection");
    } catch {
      // The injected overlay below is the durable cleanup path.
    }
    await target.webContents.executeJavaScript(`
      (() => {
        const timers = window.__lyraPageFindTimers;
        if (Array.isArray(timers)) {
          for (const timer of timers) clearTimeout(timer);
        }
        window.__lyraPageFindTimers = [];
        document.getElementById("__lyra_page_find_overlay__")?.remove();
        return true;
      })()
    `, true).catch(() => undefined);
  };

  const revealSearchInPageMatch = async (
    target: Pick<BrowserPageFindTarget, "webContents">,
    query: string,
    activeIndex: number,
    caseSensitive: boolean
  ): Promise<BrowserPageFindRevealResult> => {
    const script = `
      (async () => {
        const QUERY = ${JSON.stringify(query)};
        const TARGET_INDEX = ${JSON.stringify(activeIndex)};
        const CASE_SENSITIVE = ${JSON.stringify(caseSensitive)};
        const clearOverlay = () => {
          const timers = window.__lyraPageFindTimers;
          if (Array.isArray(timers)) {
            for (const timer of timers) clearTimeout(timer);
          }
          window.__lyraPageFindTimers = [];
          document.getElementById("__lyra_page_find_overlay__")?.remove();
        };
        clearOverlay();
        if (!QUERY || TARGET_INDEX < 1 || !document.body) {
          return { ok: false };
        }
        const normalize = (value) => CASE_SENSITIVE ? value : String(value).toLocaleLowerCase();
        const needle = normalize(QUERY);
        const rejectedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);
        const acceptNode = (node) => {
          const parent = node.parentElement;
          if (!parent || rejectedTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest("#__lyra_page_find_overlay__")) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || node.nodeValue.trim().length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode });
        let count = 0;
        let selected = null;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const source = normalize(node.nodeValue || "");
          let cursor = 0;
          while (needle.length > 0 && cursor <= source.length) {
            const index = source.indexOf(needle, cursor);
            if (index < 0) break;
            count += 1;
            if (count === TARGET_INDEX) {
              selected = { node, start: index, end: index + QUERY.length };
              break;
            }
            cursor = Math.max(index + needle.length, index + 1);
          }
          if (selected) break;
        }
        if (!selected) return { ok: false, totalScanned: count };
        const range = document.createRange();
        range.setStart(selected.node, selected.start);
        range.setEnd(selected.node, selected.end);
        const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const fallbackElementRect = selected.node.parentElement?.getBoundingClientRect?.();
        const firstRect = typeof range.getBoundingClientRect === "function"
          ? range.getBoundingClientRect()
          : fallbackElementRect;
        if (!firstRect) return { ok: false, totalScanned: count };
        if (
          firstRect.top < 80 ||
          firstRect.bottom > window.innerHeight - 80 ||
          firstRect.left < 20 ||
          firstRect.right > window.innerWidth - 20
        ) {
          window.scrollBy({
            left: firstRect.left < 20 ? firstRect.left - 80 : firstRect.right > window.innerWidth - 20 ? firstRect.right - window.innerWidth + 80 : 0,
            top: firstRect.top - Math.max(90, window.innerHeight * 0.38),
            behavior: "smooth"
          });
          await waitFrame();
          await waitFrame();
        }
        const rects = (typeof range.getClientRects === "function"
          ? Array.from(range.getClientRects())
          : []
        )
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          }));
        if (rects.length === 0 && fallbackElementRect && fallbackElementRect.width > 0 && fallbackElementRect.height > 0) {
          rects.push({
            left: fallbackElementRect.left,
            top: fallbackElementRect.top,
            right: fallbackElementRect.right,
            bottom: fallbackElementRect.bottom,
            width: fallbackElementRect.width,
            height: fallbackElementRect.height
          });
        }
        if (rects.length === 0) return { ok: false, totalScanned: count };
        const bounds = rects.reduce((acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom)
        }), {
          left: rects[0].left,
          top: rects[0].top,
          right: rects[0].right,
          bottom: rects[0].bottom
        });
        const pad = 10;
        const focus = {
          left: Math.max(0, bounds.left - pad),
          top: Math.max(0, bounds.top - pad),
          right: Math.min(window.innerWidth, bounds.right + pad),
          bottom: Math.min(window.innerHeight, bounds.bottom + pad)
        };
        const host = document.createElement("div");
        host.id = "__lyra_page_find_overlay__";
        host.setAttribute("aria-hidden", "true");
        host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style paint;";
        const style = document.createElement("style");
        style.textContent = \`
          #__lyra_page_find_overlay__ .lyra-find-blur {
            position: fixed;
            background: rgba(12, 12, 12, 0.16);
            backdrop-filter: blur(7px);
            -webkit-backdrop-filter: blur(7px);
            opacity: 0;
            transition: opacity 190ms cubic-bezier(0.16, 1, 0.3, 1);
          }
          #__lyra_page_find_overlay__ .lyra-find-highlight {
            position: fixed;
            border-radius: 3px;
            background: rgba(255, 214, 64, 0.58);
            box-shadow: 0 0 0 1px rgba(180, 125, 0, 0.36), 0 4px 18px rgba(255, 204, 51, 0.28);
            opacity: 1;
            transition: background 260ms ease, box-shadow 260ms ease, opacity 260ms ease;
            mix-blend-mode: multiply;
          }
        \`;
        host.appendChild(style);
        const panels = [
          { left: 0, top: 0, width: window.innerWidth, height: focus.top },
          { left: 0, top: focus.bottom, width: window.innerWidth, height: Math.max(0, window.innerHeight - focus.bottom) },
          { left: 0, top: focus.top, width: focus.left, height: Math.max(0, focus.bottom - focus.top) },
          { left: focus.right, top: focus.top, width: Math.max(0, window.innerWidth - focus.right), height: Math.max(0, focus.bottom - focus.top) }
        ];
        for (const panel of panels) {
          if (panel.width <= 0 || panel.height <= 0) continue;
          const node = document.createElement("div");
          node.className = "lyra-find-blur";
          node.style.left = panel.left + "px";
          node.style.top = panel.top + "px";
          node.style.width = panel.width + "px";
          node.style.height = panel.height + "px";
          host.appendChild(node);
        }
        for (const rect of rects) {
          const mark = document.createElement("div");
          mark.className = "lyra-find-highlight";
          mark.style.left = Math.max(0, rect.left - 2) + "px";
          mark.style.top = Math.max(0, rect.top - 1) + "px";
          mark.style.width = Math.max(1, rect.width + 4) + "px";
          mark.style.height = Math.max(1, rect.height + 2) + "px";
          host.appendChild(mark);
        }
        document.documentElement.appendChild(host);
        await waitFrame();
        for (const panel of host.querySelectorAll(".lyra-find-blur")) {
          panel.style.opacity = "1";
        }
        const timers = [];
        timers.push(setTimeout(() => {
          for (const panel of host.querySelectorAll(".lyra-find-blur")) {
            panel.style.opacity = "0";
          }
        }, 2000));
        timers.push(setTimeout(() => {
          for (const panel of host.querySelectorAll(".lyra-find-blur")) {
            panel.remove();
          }
          for (const mark of host.querySelectorAll(".lyra-find-highlight")) {
            mark.style.background = "rgba(255, 221, 74, 0.42)";
            mark.style.boxShadow = "0 0 0 1px rgba(170, 118, 0, 0.26)";
          }
        }, 2300));
        window.__lyraPageFindTimers = timers;
        return {
          ok: true,
          rect: {
            left: Math.round(bounds.left),
            top: Math.round(bounds.top),
            right: Math.round(bounds.right),
            bottom: Math.round(bounds.bottom)
          }
        };
      })()
    `;
    try {
      const result = await target.webContents.executeJavaScript(script, true) as Record<string, unknown>;
      const rect = result?.rect;
      if (result?.ok !== true || rect === null || typeof rect !== "object") {
        return { ok: false };
      }
      const record = rect as Record<string, unknown>;
      const left = Number(record.left);
      const top = Number(record.top);
      const right = Number(record.right);
      const bottom = Number(record.bottom);
      if ([left, top, right, bottom].every(Number.isFinite) === false) {
        return { ok: true };
      }
      return {
        ok: true,
        rect: {
          left: Math.round(left),
          top: Math.round(top),
          right: Math.round(right),
          bottom: Math.round(bottom)
        }
      };
    } catch {
      return { ok: false };
    }
  };

  const performSearchInPage = async (
    target: BrowserPageFindTarget,
    request: WorkbenchBrowserSearchInPageRequest
  ): Promise<WorkbenchBrowserSearchInPageResult & {
    readonly revealRect?: BrowserPageFindRevealResult["rect"];
  }> => {
    const query = typeof request.query === "string" ? request.query.trim() : "";
    if (query.length === 0) {
      await clearSearchInPageOverlay(target);
      return {
        tabId: target.tabId,
        address: normalizeAddress(target.webContents.getURL()) ?? target.address,
        title: target.title,
        query: "",
        currentIndex: 0,
        totalMatches: 0,
        matches: [],
        truncated: false
      };
    }
    try {
      target.webContents.findInPage(query, {
        forward: request.direction !== "previous",
        findNext: request.direction === "next" || request.direction === "previous",
        matchCase: request.caseSensitive === true
      });
    } catch {
      // Text extraction below is the authoritative result; native page highlight is best effort.
    }
    const raw = await target.webContents.executeJavaScript(`
      (() => {
        const normalizeText = (value) => {
          if (typeof value !== "string") return "";
          return value
            .replace(/\\u00a0/g, " ")
            .replace(/\\r/g, "")
            .replace(/[ \\t]+\\n/g, "\\n")
            .replace(/\\n[ \\t]+/g, "\\n")
            .replace(/\\n{3,}/g, "\\n\\n")
            .trim();
        };
        return {
          title: normalizeText(document.title ?? ""),
          text: normalizeText(document.body?.innerText ?? document.body?.textContent ?? "")
        };
      })()
    `, true) as Record<string, unknown>;
    const text = typeof raw.text === "string" ? raw.text : "";
    const result = findSearchInPageMatches(text, query, request);
    const totalMatches = result.totalMatches;
    const requestedIndex = Number.isFinite(Number(request.activeIndex))
      ? Math.round(Number(request.activeIndex))
      : 0;
    const normalizedRequestedIndex =
      totalMatches === 0 ? 0 : Math.max(1, Math.min(totalMatches, requestedIndex));
    const currentIndex = (() => {
      if (totalMatches === 0) {
        return 0;
      }
      if (request.direction === "previous") {
        return normalizedRequestedIndex <= 1 ? totalMatches : normalizedRequestedIndex - 1;
      }
      if (request.direction === "next") {
        return normalizedRequestedIndex <= 0 || normalizedRequestedIndex >= totalMatches
          ? 1
          : normalizedRequestedIndex + 1;
      }
      return normalizedRequestedIndex || 1;
    })();
    const activeMatchId =
      result.matches.find((match) => match.index === currentIndex)?.id
      ?? (currentIndex > 0 ? `find-${hashStableString(`${query}|${currentIndex}`)}` : undefined);
    const reveal = request.reveal === true && currentIndex > 0
      ? await revealSearchInPageMatch(target, query, currentIndex, request.caseSensitive === true)
      : { ok: false };
    if (request.ephemeralReveal === true && reveal.ok === true) {
      window.setTimeout(() => {
        void clearSearchInPageOverlay(target);
      }, 2800);
    }
    return {
      tabId: target.tabId,
      address: normalizeAddress(target.webContents.getURL()) ?? target.address,
      title: normalizeString(raw.title) ?? target.title,
      query,
      currentIndex,
      ...(activeMatchId === undefined ? {} : { activeMatchId }),
      ...(reveal.rect === undefined ? {} : { revealRect: reveal.rect }),
      ...result
    };
  };

  const searchInPage = async (
    request: WorkbenchBrowserSearchInPageRequest
  ): Promise<WorkbenchBrowserSearchInPageResult> => {
    const tabId = normalizeString(request.tabId) ?? getActiveOrFocusedTabId();
    if (tabId === null) {
      throw new Error("tab_not_found");
    }
    const entry = requireEntry(tabId);
    return await performSearchInPage(
      {
        tabId,
        webContents: entry.webContents,
        address: entry.runtime.address,
        title: entry.runtime.title
      },
      request
    );
  };

  return {
    clearSearchInPageOverlay,
    performSearchInPage,
    searchInPage
  };
};
