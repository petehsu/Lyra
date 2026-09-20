# lyra-browser-service

Audience: Internal
Status: Active
Last verified: 2026-09-19

工作区浏览器引擎的稳定进程是 `lyra-browser-service`，不是 Electron，也不是 `lyrad`。
按需启动，CDP `1.3`，实现 `LyraBrowserApi`（见 [lyra-browser-api.md](lyra-browser-api.md)）。
壳用工作区坐标贴页面（见 [browser-shell-layout.md](browser-shell-layout.md)），不要把 `addChildView` 写成对外协议。

清单由 `apps/desktop/src/shared/lyra-browser-service.ts` 看守。`lyrad` 不得路由 `browser.*`。

## 是什么 / 不是什么

| 名字 | 角色 |
| --- | --- |
| `lyra-browser-service` | 引擎进程（本契约） |
| `lyra.runtime` / `lyrad` | Core daemon：agent / terminal / lsp / search / download / performance |
| `lyra.browser` | 第一方 Browser 应用组件（UI），不是引擎进程 |
| `apps/desktop/src/main/workbench-browser` | 当前 Electron 适配：`WebContentsView` + `webContents.debugger` |

CDP 事件归一化继续用 `@lyra/browser-automation` 的 `cdp_inspector`。它不依赖 Electron。

## 现在还没离开 Electron

当前实现仍在 Electron 同进程里。用户看到的网页还是钉在现有窗口上。
本项冻的是进程边界：引擎适配接 `lyra-browser-service`，不要再长一条 `lyrad` 浏览器路由，也不要把 view-manager 整包搬进别的壳。

真正另起 Chromium/CEF 不能在当前 Electron + Wayland 壳里单独做完：没有 CEF 二进制，钉页也只有 `addChildView`。外进程页面现在嵌不进工作区。要用户仍能在工作区里打开网页，得新壳带着引擎一起换。
