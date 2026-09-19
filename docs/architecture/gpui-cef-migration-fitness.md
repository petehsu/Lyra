# Lyra 架构迁移检查：GPUIX + Rust Core + CEF Browser Service

Audience: Internal
Status: Check
Last verified: 2026-09-19

只检查当前仓库是否适合平滑迁到：

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

本文不是目标态 ADR，也不建议推翻现有 Rust Core。检查基于当前代码与现有架构文档，不改产品代码。

---

## 结论

当前架构迁移友好度：**中**

Renderer / modules / packages **零** `from 'electron'`，业务已经走统一的 `window.lyraDesktop` / `LyraDesktopApi`；`lyrad` 是独立本地 daemon，`lyra-cli` 能不经 Electron 连同一套 runtime socket。GPUIX 可以替换 Electron main，继续调 `lyrad` 与现有 crates。

不能算「高」：浏览器引擎仍与 Electron `WebContentsView` / `session` / `webContents.debugger` 同进程嵌套；Agent 回调 Desktop 的 host capability 还是 `Record<string, handler>`，没有冻成可替换契约；files / 图像 / 文档 / 无障碍走 Node NAPI，不走 `lyrad`。现有 React 工作台不能整块搬进 GPUIX——那是壳重写成本，不是 Rust Core 阻塞。

---

## 最大阻塞项

1. **浏览器引擎与 Electron `webContents` 同进程嵌套。** `apps/desktop/src/main/workbench-browser` 共 122 个 `.ts` 文件。`layout-controller.ts` 用 `rootView.addChildView` / `view.setBounds` 把页面嵌进主窗口；`debugger.ts` 的 `createWorkbenchBrowserSharedDebuggerSession` 入参是 `WebContents`，CDP 走 `webContents.debugger.attach("1.3")`。

2. **`WorkbenchBrowserApi` 把壳层排版和引擎能力绑在同一接口。** `desktop-bridge.ts` 里 `syncLayout` / `syncTopology` / `setChromePopover` 与 `navigate` / cookies / capture 并列；renderer 侧 `browser-layout-sync.ts` 用 `getBoundingClientRect()` 把 DOM 矩形推给 main。独立 CEF 进程接不了这个嵌入模型。

3. **Agent host capability 没有冻成可替换契约。** `AgentHostCapabilityHandlers = Record<string, RuntimeRequestHandler>`（`apps/desktop/src/main/agent/host-payload.ts`）。实现散落在 `lumen-tool-host.ts`、`ax-tool-host.ts`、`computer-tool-host.ts`、`workbench-observation-adapter.ts` 等，由 `createAgentIpcBridge` 调 `runtimeClient.registerRequestHandler`。新壳必须复现同一批字符串方法，但当前没有 typed union。

4. **Files / 图像 / 文档 / 无障碍不走 `lyrad`。** `crates/lyrad/src/router.rs` 只路由 `search.` / `terminal.` / `lsp.` / `download.` / `agent.` / `performance.`。files 由 `apps/desktop/src/main/files/native-loader.ts` `dlopen` `lyra_files_napi`。GPUIX 不能复用这条 Node 加载链。

5. **`LyraDesktopApi` 里仍有 DOM/Electron 泄漏。** `FilesApi.getPathForFile(file: File)` 依赖浏览器 `File` 与 preload `webUtils`。不先从稳定接口拿掉，Desktop API 无法被 GPUIX 原样承接。

---

## 建议先做的改造

1. **拆 `WorkbenchBrowserApi`。** 壳层只留 topology / layout / popover；引擎侧（navigate、session、site data、CDP `sendCommand`、download handoff）收成无 `WebContents` 类型的 `lyra-browser-api`。现有 `WorkbenchBrowserDebuggerSession`（`sendCommand` / `subscribe`）可作引擎接口原型。

2. **把 host capability 方法名收成显式清单。** 现有 `lyraLumen.*` / `lyraAx.*` / `lyraComputer.*` / `workbench.*` / `workbench.browser.*` 替换 `Record<string, …>`，让 Electron 与未来 GPUIX 实现同一组字符串。

3. **把 `createWorkbenchBrowserSharedDebuggerSession(webContents)` 留在 Electron 适配层。** 观察与审计只依赖已有 `WorkbenchBrowserDebuggerSession`。`services/browser-automation` 的 CDP 归一化（`cdp_inspector`）已不依赖 Electron，可继续给 CEF CDP 用。

4. **冻结 GPUIX 接 Core 的入口为现有 runtime socket。** 协议 `2-2`、`HOST_API_VERSION = "1.0.0"`，见 `docs/contracts/runtime-socket.md`。GPUIX 作为壳必须当 `primaryHost` 并注册 host handlers（与 Electron `runtime-client.ts` 的角色相同）。`lyra-cli` 的 `RuntimeSocketClient` 证明 Rust 客户端能连 `lyrad.sock`，但它握手的是 `AuxiliaryClient`，**不能**当壳的角色模板。

5. **明确 files 不走 NAPI。** `lyra-files-core` 无 napi 依赖；新壳直接链这个 crate（或以后再加 daemon 路由）。不要把 `FilesApi.getPathForFile(file: File)` 带进稳定 Desktop API。

---

## 分项证据

### 1. Electron 耦合程度

业务 UI 不直接调 Electron。`apps/desktop/src/renderer` 与 `apps/desktop/src/modules` 对 `from 'electron'` / `ipcRenderer` 均为 0。Electron import 集中在 `main` 与 `preload`。`docs/architecture/overview.md` 与 `docs/architecture/desktop-processes.md` 已规定 renderer 不得直接 import Electron；preload 用固定 `LYRA_CHANNELS`，不向 renderer 暴露 raw `ipcRenderer`。

对迁移：换壳不必先拆组件里的 Electron import。负载在 main 的窗口 / 视图 / session 适配层。

### 2. 前端与桌面壳分离程度

UI 经 `LyraDesktopApi` 注入。`apps/desktop/src/renderer/lyra-desktop.d.ts` 声明 `window.lyraDesktop`；`apps/desktop/src/modules/workbench/shell/service.ts` 的 `getDesktopApi()` 读取它。测试可 mock `globalThis.lyraDesktop`。

视图层强绑 DOM / CSS / Web 控件：工作台是 React；编辑器 `monaco-editor`；终端 `xterm`；Radix；`@lyra/workbench-ui-runtime` 依赖 `react` / `react-dom`。

对迁移：脱离 Electron、在 mock bridge 下跑工作台**逻辑**可行。把同一套 React 工作台搬进 GPUIX（原生 GUI，不是 webview）不可行。这是壳重写，不是 Core 迁移阻塞。

### 3. Rust Core 独立性

根 `Cargo.toml` 有 25 个 workspace members。`crates/lyrad` 依赖 `lyra-agent-runtime`、`lyra-download-core`、`lyra-lsp-core`、`lyra-terminal-core`、`lyra-performance-core`、`lyra-runtime-protocol`，无 electron / napi。`lyra-agent-runtime` 无 napi。`lyra-computer-use-core` 注释写明无 napi、无 Electron bridge。`lyra-files-core` 仅 lru / notify / serde。

专用 napi crate 4 个：`lyra-files-napi`、`lyra-image-napi`、`lyra-docs-napi`、`lyra-accessibility-napi`。可选 `node-api` feature 2 个：`lyra-lsp-core`、`lyra-terminal-core`。workspace 排除 `archive/lyra-local-inference-core`；推理在 `lyra-agent-runtime` 的 provider 路径。

`lyra-cli` 直接依赖 `lyra-agent-runtime` 并经 `RuntimeSocketClient` 连 daemon。

对迁移：GPUIX 可直接调 crates / `lyrad`。NAPI 只是 Electron / Node 适配，不必推翻 Core。Files 若继续只用 napi loader，新壳要另接 `lyra-files-core`。

### 4. IPC 边界

已有统一 Desktop API：

- `apps/desktop/src/shared/desktop-bridge.ts`：`LYRA_CHANNELS`、`LyraDesktopApi`
- `apps/desktop/src/preload/index.ts`：`contextBridge` 暴露 `window.lyraDesktop`
- `docs/generated/ipc.md`：当前 **288** 个 channel
- `docs/contracts/desktop-ipc-preload.md`、`docs/contracts/runtime-socket.md`

`LyraDesktopApi` 已覆盖 `files`、`terminal`、`agent`（定义在 `apps/desktop/src/shared/agent.ts`）、`search`、`workbenchBrowser`。`search` 在 Desktop API 上只有 `resolveWebSearchEngine`；站内流在 `lyrad` 的 `search.site.stream.*`。浏览器字段名是 `workbenchBrowser`，不是 `browser`。

另有一条 **runtime socket**（protocol `2-2`）：Electron main 作为 `primaryHost` 连 `lyrad`，daemon 可回调已注册的 host capability。这比 288 个 Electron channel 更接近目标图里的 Desktop API → Rust Core。

对迁移：边界清晰，可逐步收敛成稳定接口。需要从稳定面去掉 DOM 类型，并把 `workbenchBrowser` 拆成壳 / 引擎两层。不要把 288 个 `lyra:*` channel 原样当成 GPUIX ABI。

### 5. Browser 模块

用户浏览与 Agent 自动化都是 Electron `WebContentsView` 系统，见 `docs/architecture/browser-automation.md`。

- Profile：`persist:lyra-browser-live` / `persist:lyra-browser-isolated`
- Cookies：Electron `session.cookies`
- Downloads：`session.on("will-download")` + `download-manager/browser-handoff.ts`
- CDP：`webContents.debugger`，协议 1.3；类型上已有 `WorkbenchBrowserDebuggerSession`
- `crates/lyra-agent-runtime` 只列 browser host capability 元数据，不实现浏览器引擎
- `services/browser-automation` 的 CDP inspector 不依赖 Electron；Playwright runner 是 stub

对迁移：抽 `lyra-browser-api` 再换成按需启动的 `lyra-browser-service` **可行**，前提是先切开 layout 嵌入与引擎 / CDP。不能把当前 view-manager 当 CEF 服务直接搬。已有 CDP 1.3 用法与 `sendCommand` 抽象，和独立 Chromium + CDP 同构。

### 6. 进程与模块边界

现状（`docs/architecture/overview.md`）：

```text
Sandboxed renderer
    → window.lyraDesktop
    → Electron main
    → newline JSON / lyrad
    → Agent / terminal / download / LSP / search / performance

Daemon 回调 Desktop host capabilities
    （browser / workbench / computer / …）

Files / image / docs / a11y
    → Node NAPI shims → *-core
```

与目标图同构的部分：`lyrad` + crates ≈ Rust Core；host capability 回调 ≈ 新壳必须实现的 Desktop API 子集；CDP ≈ Browser Service 协议。

缺口：Browser 仍嵌在 Electron main；Desktop API 的 TS/IPC 形态还不是 GPUIX 可调用的 ABI；files 不在 daemon；壳若当 `primaryHost`，会与当前 Electron main 抢同一 lease（`runtime-client.ts` 会因 `RUNTIME_PRIMARY_HOST_EXISTS` 失败）。

GPUIX 接管路径（已有代码，不是新路线）：作为 `primaryHost` 连 `lyrad.sock`，实现同一批 host capability；Agent / Search / Terminal / LSP / Download 走 daemon；Files / Image 链 `*-core`；Browser 另进程 + CDP，实现与 `lyraLumen.*` / `workbench.browser.*` 相同的 host 方法。Electron 的 Node `runtime-client.ts` 不必移植。

### 7. 迁移阻塞分桶

**必须先改**

- 从 `WebContents` / `WebContentsView` / Electron `session` 类型中抽出浏览器引擎 API（tabs、navigate、site data、CDP `sendCommand`、download handoff）。
- 冻结 Agent host capability 方法清单（现在是 `Record<string, handler>` + 分散在多个 `*-tool-host.ts`）。
- 把 `syncLayout` / `syncTopology` 从引擎 API 分开；独立 Browser Service 不能靠 DOM `getBoundingClientRect` + `addChildView`。
- 从稳定 `FilesApi` 去掉 `getPathForFile(file: File)`。

**迁移中再处理**

- 用 GPUIX 重写 React / Monaco / xterm / Radix / SCSS 工作台（壳成本，不是 Core）。
- Electron `desktopCapturer` / `screen` → OS 捕获。
- `safeStorage`、通知、窗口材质、auto-update、location 等 OS 适配。
- Login manager / cookie vault 对 `webContents.session.cookies` 的依赖。
- 停用 napi loader；GPUIX 直接链 `lyra-files-core` 等。
- Third-party `WebContentsView`；WASI 后端可保留。
- `services/browser-automation` Playwright stub；真正自动化走 CEF CDP。
- Node `runtime-client.ts` 可弃用，改用 Rust socket client，但握手角色必须是 `primaryHost`，不是 CLI 的 `AuxiliaryClient`。

**不影响迁移**

- Renderer / modules 不 import Electron；`LyraDesktopApi` 已覆盖 files / terminal / agent / search / workbenchBrowser。
- `lyrad` + `lyra-runtime-protocol` + `lyra-cli` 已证明 Core 可被非 Electron 客户端调用。
- `lyra-agent-runtime`（含 `HostCapabilityDispatcher`）、`lyra-terminal-core`、`lyra-download-core`、`lyra-lsp-core`、`lyra-files-core`、`lyra-computer-use-core` 对 Electron 无依赖。
- CDP 事件归一化（`@lyra/browser-automation` `cdp_inspector`）与 `WorkbenchBrowserDebuggerSession` 类型。
- 边界检查与 preload 不向 renderer 暴露 raw `ipcRenderer`。
- 仓库内无 GPUIX——预期缺口，不是现有 Core 耦合。
