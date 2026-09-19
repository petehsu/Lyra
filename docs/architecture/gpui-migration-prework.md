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

**现在不能开 GPUIX 壳。** 做完下列 1–4，才能说 Desktop API 能被第二个壳接住；做完 5–7，工作区浏览器才能跟 GPUIX 并排存在。第 8 项是划界，和 1–4 一起冻。

---

## 已经做完

`LyraDesktopApi` 上的 `workbenchBrowser` 已拆成：

| 字段 | 契约 | 管什么 |
| --- | --- | --- |
| `browserShell` | `BrowserShellApi`（`apps/desktop/src/shared/browser-shell-api.ts`） | layout / topology / popover / 遮挡 |
| `browser` | `LyraBrowserApi`（`apps/desktop/src/shared/lyra-browser-api.ts`） | 未来的 lyra-browser-api：navigate、tab、cookies / site data、capture |

IPC 通道名仍是 `lyra:workbench-browser/*`。引擎仍在 Electron 同进程里。不要再拆一次类型。

---

## 开始逐步迁 GPUIX 之前

按依赖顺序。前一项没冻，不要跳去做 GPUIX 界面。

### 1. 冻 Agent host capability 方法名

现状：`AgentHostCapabilityHandlers = Record<string, RuntimeRequestHandler>`（`apps/desktop/src/main/agent/host-payload.ts`）。实现散落在 `lumen-tool-host.ts`、`ax-tool-host.ts`、`computer-tool-host.ts`、`workbench-observation-adapter.ts`、`terminal-tool-host.ts`、`favorites-tool-host.ts`，由 `runtimeClient.registerRequestHandler` 挂上。

把现有字符串收成显式清单，至少包括：

- `lyraLumen.*`：map、act、vact、reveal、type、press、scroll、focusScan、followAudit、explainTarget、audit、elevate、completeElevation、resolveControlHandoff、navigate、reload、read、see、detectQr、wait
- `lyraAx.*`：map、query、act、focus、press、explain
- `lyraComputer.*`：listApps、observe、focus、map、find、act、diff、explain、see
- `workbench.*`：listTabs、readTab、activateTab、closeTab、reorderTab、splitTabs、detachSplit、listTerminals、openTerminal、focusTerminal、closeTerminal、moveTerminal、readWorkspace、captureVisualEvidence、extractTabText、listFavorites、removeFavorite
- `workbench.browser.*`：readSessionSnapshot、readStorageState、clearSiteData、readRenderedSnapshot
- `terminal.list` / `terminal.read` / `terminal.write`

Electron 和以后的 GPUIX 必须实现同一组名字。没有这份清单，新壳接不上 `lyrad` 对 Desktop 的回调。

### 2. 冻 GPUIX 进 Core 的入口

入口是现有 runtime socket，见 [runtime-socket.md](../contracts/runtime-socket.md)：

- 协议范围 `2-2`
- `HOST_API_VERSION = "1.0.0"`
- 壳的角色是 **`primaryHost`**，并注册 host handlers（与 Electron `runtime-client.ts` 相同）

不要抄 `lyra-cli`：它的握手是 `AuxiliaryClient`，不能当壳的角色模板。

同一时刻只能有一个 `primaryHost`。Electron main 占着 lease 时，GPUIX 再连会得到 `RUNTIME_PRIMARY_HOST_EXISTS`。迁的时候要有交接：谁当壳、谁让出 socket。

### 3. 从稳定 Desktop API 拿掉 DOM 类型

至少：`FilesApi.getPathForFile(file: File)`（`apps/desktop/src/shared/desktop-bridge.ts`）。它依赖浏览器 `File` 和 preload `webUtils`。

GPUIX 没有浏览器 `File`。拖文件进对话要改成「壳给出路径字符串」，不能把 `File` 带进稳定面。

不要把现有 288 个 `lyra:*` Electron channel（`docs/generated/ipc.md`）原样当成 GPUIX ABI。

### 4. Files / 图像 / 文档 / 无障碍离开 Node NAPI

`crates/lyrad/src/router.rs` 只路由 `search.` / `terminal.` / `lsp.` / `download.` / `agent.` / `performance.`。

files 由 `apps/desktop/src/main/files/native-loader.ts` `dlopen` `lyra_files_napi`。GPUIX 不能复用这条 Node 加载链。

新壳应直接链 `lyra-files-core`（图像、文档、无障碍同理：对应 `*-core`，不走 napi loader）。NAPI 只留给 Electron，不当稳定路径。也不要把第 3 项的 `getPathForFile(file: File)` 带进这条稳定面。

### 5. 把 lyra-browser-api 做成无 `WebContents` 的引擎契约

`desktopApi.browser` 仍是 preload 调 `lyra:workbench-browser/*`，main 仍是 `WebContentsView` + `webContents.debugger`。

需要：

- 引擎实现的公开类型里不再出现 `WebContents` / `Session`
- CDP `sendCommand` / 事件挂在引擎上；现有 `WorkbenchBrowserDebuggerSession`（已 alias 到 `LyraBrowserCdpSession`）当原型
- `createWorkbenchBrowserSharedDebuggerSession(webContents)` 留在 Electron 适配层
- cookies / site data / download handoff 走引擎，不把 `session.cookies` / `will-download` 暴露为对外类型
- renderer 沙箱不要 preload 任意 CDP `sendCommand`

### 6. 换掉「DOM 矩形钉页面」这条 layout 协议

`apps/desktop/src/modules/workbench/shell/browser-layout-sync.ts` 仍用 `getBoundingClientRect()` 推给 main 的 `addChildView` / `setBounds`。独立 CEF 接不了这条。

`browserShell` 的 bounds 要改成工作区坐标（谁是壳谁提供矩形），不再量 DOM。

### 7. 引擎真正离开 Electron 进程

目标图里的 `lyra-browser-service`：按需起 Chromium/CEF，CDP 1.3，实现第 5 步那份 API。`services/browser-automation` 的 CDP 归一化（`cdp_inspector`）不依赖 Electron，可继续用。

这一步完成前，工作区里的网页仍绑在 Electron 窗口上，GPUIX 嵌不进去。

### 8. 分清 Core API 和这台机器的壳

GPUIX 要接的是：agent / terminal / lsp / search / download / files / browser engine。

窗口材质、通知、`safeStorage`、auto-update、location、登录态 cookie 保险库，是 OS 适配，换壳时另接，不要混进 Core 契约。

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

做 **1**（host capability 清单）。
