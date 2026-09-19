# lyra-browser-api

Audience: Internal
Status: Active
Last verified: 2026-09-19

工作区浏览器的引擎契约是 `LyraBrowserApi`（`apps/desktop/src/shared/lyra-browser-api.ts`），不含 Electron `WebContents` / `Session`。
壳层 layout / topology / popover 仍是 `BrowserShellApi`，不要并回这一份。

Electron 渲染进程只拿到 `LyraBrowserRendererApi`（`LyraDesktopApi.browser`）。CDP `sendCommand` 不 preload。
Electron 适配仍用 `createWorkbenchBrowserSharedDebuggerSession({ webContents })`（`apps/desktop/src/main/workbench-browser/debugger.ts`）。
CEF / GPUIX 实现同一份 `LyraBrowserApi`，包括 `cdp`。不要把 `session.cookies` / `will-download` 做成对外类型。

## 渲染进程方法

`LYRA_BROWSER_RENDERER_METHODS`：

navigate、goBack、goForward、reload、stop、readPageState、readSessionSnapshot、readStorageState、clearSiteData、searchInPage、setElementPickerMode、capturePage、captureWindow、executePageContextAction、readActivePageDragCitation、consumePageDragCitation、onEvent

cookies / site data 走 `readStorageState` / `clearSiteData`，DTO 是 `BrowserStorageStateRef`。

## 只给宿主

`LYRA_BROWSER_HOST_ONLY_METHODS`：`cdp`、`downloads`。

- `cdp`：CDP `LYRA_BROWSER_CDP_PROTOCOL_VERSION`（`1.3`）。会话形状是 `LyraBrowserCdpSession`（`sendCommand` / `subscribe` / `close`）。Electron 的 `WorkbenchBrowserDebuggerSession` 在这上面加了 `focus`，那是适配，不是契约。
- `downloads`：引擎可以有。Electron 渲染进程仍用 `LyraDesktopApi.downloads`；`will-download` 和 cookie header 留在 `apps/desktop/src/main/download-manager/`。

## 不是本契约

- 壳 layout 坐标（见 [browser-shell-layout.md](browser-shell-layout.md)）
- 引擎进程边界（见 [lyra-browser-service.md](lyra-browser-service.md)）

看守：`apps/desktop/src/shared/lyra-browser-api.test.ts`。
