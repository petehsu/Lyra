# GPUIX 逐步迁移：开始前还要做的事

Audience: Internal
Status: Check
Last verified: 2026-09-19

本文是工作清单，不是目标态 ADR，也不推翻现有 Rust Core。

目标架构：

```text
GPUIX Shell
    ↓
Lyra Desktop API
    ↓
Rust Core

Browser API
    ↓
lyra-browser-service
    ↓
CEF / Chromium / CDP
```

友好度检查见 [gpui-cef-migration-fitness.md](gpui-cef-migration-fitness.md)。UI 能留多少见 [gpui-uiux-retainability.md](gpui-uiux-retainability.md)。

**现在不能开 GPUIX 壳。** 1–8 已冻契约面：第二个壳能对上名字和入口；引擎实现仍在 Electron 里，GPUIX 还嵌不进网页。OS 适配仍由当前窗口提供。

---

## 已经做完

`LyraDesktopApi` 上的 `workbenchBrowser` 已拆成：

| 字段 | 契约 | 管什么 |
| --- | --- | --- |
| `browserShell` | `BrowserShellApi`（`apps/desktop/src/shared/browser-shell-api.ts`） | layout / topology / popover / 遮挡 |
| `browser` | `LyraBrowserApi`（`apps/desktop/src/shared/lyra-browser-api.ts`） | 引擎：navigate、cookies / site data、capture；宿主另有 `cdp`。渲染进程是去掉 `cdp`/`downloads` 的 `LyraBrowserRendererApi` |

IPC 通道名仍是 `lyra:workbench-browser/*`。引擎仍在 Electron 同进程里。不要再拆一次类型。

Agent host capability 方法名已冻：`apps/desktop/src/shared/agent-host-capabilities.ts`。`AgentHostCapabilityHandlers` 只接受这份清单里的名字；`createAgentIpcBridge` 注册前会拒绝清单外的方法。Electron 和以后的 GPUIX 必须实现同一组名字。增删名字改这一处。

GPUIX 进 Core 的入口已冻：壳握手必须是 `primaryHost` + 协议 `2-2` + `runtime.host.requests` + `lyra.desktop` v1。清单在 `apps/desktop/src/shared/runtime-shell-handshake.ts` 与 `crates/lyra-runtime-protocol`。`lyra-cli` 的 `auxiliaryClient` 不是壳模板。同一时刻只能有一个 `primaryHost`；交接是先断线再认领（`disconnectThenClaim`），没有抢 lease 的 RPC。并发认领返回 `RUNTIME_PRIMARY_HOST_EXISTS`。

稳定 `FilesApi` 已拿掉 DOM `File`。拖文件进对话由 Electron 壳 `window.lyraElectron.getPathForFile` 转成路径字符串；GPUIX 直接给路径，不要把 `File` 加回 `LyraDesktopApi`。

Files / 图像 / 文档 / 无障碍的稳定面是 `*-core`，不是 Node NAPI。配对清单在 [native-core-path.md](../contracts/native-core-path.md)，由 `tools/verify-native-core.ts` 的 `STABLE_CORE_PATHS` 看守。Electron 可以继续 `dlopen` `*-napi`。GPUIX 直接链 core crate。不要做成 `lyrad` 新路由，也不要把 `FilesApi.getPathForFile(file: File)` 加回来。

引擎契约已冻成无 `WebContents` 的 `LyraBrowserApi`，见 [lyra-browser-api.md](../contracts/lyra-browser-api.md)。`LyraDesktopApi.browser` 是渲染进程那一份（没有 `cdp`）。CDP `1.3` 的 `sendCommand` 挂在引擎 `cdp` 上，不要 preload。Electron 仍用 `createWorkbenchBrowserSharedDebuggerSession(webContents)`。cookies / site data 走 `readStorageState` / `clearSiteData`。IPC 仍是 `lyra:workbench-browser/*`，引擎仍在 Electron 同进程里。

`browserShell.syncLayout` 已改成工作区坐标，见 [browser-shell-layout.md](../contracts/browser-shell-layout.md)。壳提供矩形；引擎不量 DOM。Electron 仍可用渲染视口的 `getBoundingClientRect`，但必须变成 `coordinateSpace: "workbench"` 再交给 native `setBounds`。

引擎进程边界已冻：稳定面是 `lyra-browser-service`（按需、CDP 1.3、实现 `LyraBrowserApi`），见 [lyra-browser-service.md](../contracts/lyra-browser-service.md)。不是 `lyrad`，也不是 `lyra.browser` 应用组件。当前实现仍是 Electron `WebContentsView`。CDP 归一化继续用 `@lyra/browser-automation` 的 `cdp_inspector`。

Core 和这台机器的壳已划开，见 [core-api-os-shell.md](../contracts/core-api-os-shell.md)。GPUIX 接 agent / terminal / lsp / search / download / files / browser。窗口材质、通知、`safeStorage`、auto-update、location、登录 cookie 保险库仍是 OS 适配。`LyraDesktopApi` 没拆，渲染 IPC 不变。

---

## 开始逐步迁 GPUIX 之前

按依赖顺序。前一项没冻，不要跳去做 GPUIX 界面。

- [x] ~~1. 冻 Agent host capability 方法名~~
- [x] ~~2. 冻 GPUIX 进 Core 的入口~~
- [x] ~~3. 从稳定 Desktop API 拿掉 DOM 类型~~
- [x] ~~4. Files / 图像 / 文档 / 无障碍离开 Node NAPI~~
- [x] ~~5. 把 lyra-browser-api 做成无 `WebContents` 的引擎契约~~
- [x] ~~6. 换掉「DOM 矩形钉页面」这条 layout 协议~~
- [x] ~~7. 引擎真正离开 Electron 进程~~
- [x] ~~8. 分清 Core API 和这台机器的壳~~

### ~~1. 冻 Agent host capability 方法名~~ — 已做

清单即现有 `registerRequestHandler` 实际挂上的名字，不是文档「至少包括」的子集。除 Lumen / AX / Computer / workbench / workbench.browser / terminal 外，还有：

- `software.*`：listCapabilities、inspectCapability、readState、invokeCapability
- `agent.readHostPersonaContext` / `agent.readLocalSignals` / `agent.readPersonaConsent` / `agent.readSpatiotemporalContext`
- `mcp.oauth.openAuthorizationUrl`
- `sensitiveValues.storeForAgentUse` / `sensitiveValues.resolveForAgentUse`（有 store/resolve 回调才挂）

`runtimeClient.registerRequestHandler` 本身仍是 `method: string`（aria2 等其它 host-request 也走它）。冻的是 Agent host capability 这一层。

### ~~2. 冻 GPUIX 进 Core 的入口~~ — 已做

入口是现有 runtime socket，见 [runtime-socket.md](../contracts/runtime-socket.md)。壳必须：

- 协议范围 `2-2`
- `HOST_API_VERSION = "1.0.0"`
- `connectionRole: primaryHost`
- 能力含 `runtime.host.requests`（让 daemon 回调 host handlers）
- data schema 含 `lyra.desktop` v1

不要抄 `lyra-cli`：它的握手是 `auxiliaryClient`，`is_runtime_shell_handshake` / `isRuntimeShellHandshake` 会判否。

同一时刻只能有一个 `primaryHost`。占着 lease 时再连会得到 `RUNTIME_PRIMARY_HOST_EXISTS`。交接：前一个壳断开 socket，后一个再握手认领。lyrad 已覆盖这条：`daemon_accepts_handshake_and_reconnects_after_disconnect`。不要加 yield/steal RPC。

### ~~3. 从稳定 Desktop API 拿掉 DOM 类型~~ — 已做

`FilesApi.getPathForFile(file: File)` 已从 `apps/desktop/src/shared/desktop-bridge.ts` 拿掉。稳定面只接收路径字符串。

Electron 沙箱里 HTML5 拖拽仍有浏览器 `File`：preload 用 `webUtils` 挂在 `window.lyraElectron.getPathForFile`，不进 `LyraDesktopApi`。对话附件 / Skills 安装走 `resolveElectronFilePath`。GPUIX 没有 `File`，壳直接给路径。

不要把现有 288 个 `lyra:*` Electron channel（`docs/generated/ipc.md`）原样当成 GPUIX ABI。

### ~~4. Files / 图像 / 文档 / 无障碍离开 Node NAPI~~ — 已做

稳定路径见 [native-core-path.md](../contracts/native-core-path.md)：

| 域 | GPUIX 链 | Electron 仍可 `dlopen` |
| --- | --- | --- |
| Files | `lyra-files-core` | `lyra-files-napi` |
| Image | `lyra-image-core` | `lyra-image-napi` |
| Docs | `lyra-docs-core` | `lyra-docs-napi` |
| Accessibility | `lyra-computer-use-core` | `lyra-accessibility-napi` |

`lyrad` 继续只路由 `search.` / `terminal.` / `lsp.` / `download.` / `agent.` / `performance.`。不要给 files / image / docs / a11y 加 daemon 方法。core crate 不得依赖 napi，也不得做成 cdylib。

trash / mount / eject / 主机盘点、以及 `FilesApi.selectAttachments` / `selectDirectories`，现在还在 napi 或 Electron dialog，不是本项稳定面。

### ~~5. 把 lyra-browser-api 做成无 `WebContents` 的引擎契约~~ — 已做

契约见 [lyra-browser-api.md](../contracts/lyra-browser-api.md)。

- 公开类型：`LyraBrowserApi` / `LyraBrowserCdpSession`，没有 `WebContents` / Electron `Session`
- 渲染进程：`LyraBrowserRendererApi` = 去掉 `cdp` 和 `downloads`；preload 的 `browser` 对象没有 `sendCommand`
- CDP：协议 `1.3`，`LyraBrowserApi.cdp`。Electron 的 `WorkbenchBrowserDebuggerSession` 仍是 `LyraBrowserCdpSession` + `focus`
- Electron 适配：`createWorkbenchBrowserSharedDebuggerSession({ webContents })` 留在 `debugger.ts`
- cookies / site data：`readStorageState` / `clearSiteData`。download handoff 的 `session.cookies` / `will-download` 留在 `download-manager`

引擎实现仍是同进程 `WebContentsView`。那是第 7 项。

### ~~6. 换掉「DOM 矩形钉页面」这条 layout 协议~~ — 已做

契约见 [browser-shell-layout.md](../contracts/browser-shell-layout.md)。

`syncLayout` 的 snapshot 带 `coordinateSpace: "workbench"`。原点是工作区表面左上角，单位是 CSS 像素。壳提供矩形，引擎不量 DOM。

Electron 适配仍在 `browser-layout-sync.ts` 量渲染视口，经 `toWorkbenchLayoutBounds` 再送。`layout-controller` 把这些数字 1:1 `setBounds`。GPUIX 直接给同一套数字。

### ~~7. 引擎真正离开 Electron 进程~~ — 已冻边界

契约见 [lyra-browser-service.md](../contracts/lyra-browser-service.md)。

稳定进程是 `lyra-browser-service`：按需起、CDP `1.3`、实现第 5 步的 `LyraBrowserApi`。不要做成 `lyrad` 新路由，也不要把 `lyra.browser` 应用组件当成引擎进程。

`@lyra/browser-automation` 的 `cdp_inspector` 不依赖 Electron，继续给 CDP 事件用。

当前网页仍钉在 Electron `WebContentsView` 上。真正另起 Chromium/CEF 是迁引擎时做。
本机会话是 Wayland，现有钉页只有同进程 `addChildView`，仓库里也没有 CEF 二进制。在仍用当前窗口当壳时把引擎挖走，工作区里的网页会先消失。

### ~~8. 分清 Core API 和这台机器的壳~~ — 已冻名单

契约见 [core-api-os-shell.md](../contracts/core-api-os-shell.md)。

GPUIX 要接的是：`agent` / `terminal` / `lsp` / `search` / `downloads` / `files` / `browser`。

窗口材质、通知、`safeStorage`、auto-update、location、登录态 cookie 保险库，是 OS 适配。Electron 仍实现它们。不要做成 `lyrad` 新路由，也不要拆 `LyraDesktopApi` 的渲染 IPC。

---

## 不是「开始前」要做的

这些是迁的时候才做，见 [gpui-uiux-retainability.md](gpui-uiux-retainability.md)：

- Monaco 和 GPU overlay
- xterm
- Composer 的 contentEditable 芯片
- 2.2 万行 SCSS / Tailwind / className
- Radix
- HTML5 拖拽

那是换皮，不是换接口。接口没冻就开写 GPUIX 界面，两边会一起漂。

---

## 建议下一项

不要在当前 Electron 窗口里先挖引擎。本机是 Wayland，钉页只有同进程 `addChildView`，仓库没有 CEF。另起进程现在改不了「地址栏回车，网页出现在工作区里」这一下。

能看见网页仍在工作区的迁法：新壳带着 Chromium/CEF 一起换。不要先开写 GPUIX 界面，也不要先起一个空的 `lyra-browser-service`。
