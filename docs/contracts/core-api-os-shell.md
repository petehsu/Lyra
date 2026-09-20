# Core API vs this-machine shell

Audience: Internal
Status: Active
Last verified: 2026-09-19

Core 是 agent / terminal / lsp / search / download / files / browser engine。
窗口材质（`windowMaterial`）、通知（`systemNotifications`）、`safeStorage`、auto-update（`appUpdate`）、location、登录态 cookie 保险库（`loginCookieVault`）是这台机器的壳。
不要把后者混进 Core 契约，也不要做成 `lyrad` 新路由。

清单由 `apps/desktop/src/shared/core-api-os-shell.ts` 看守。
**不要拆渲染 IPC。** `LyraDesktopApi` 现在仍同时挂着 Core 和壳；本项只冻名单。

## Core

| `LyraDesktopApi` 字段 | 现在怎么走 |
| --- | --- |
| `agent` | `lyrad` `agent.` + 已冻的 host capability |
| `terminal` | `lyrad` `terminal.` |
| `lsp` | `lyrad` `lsp.` |
| `search` | `lyrad` `search.` |
| `downloads` | `lyrad` `download.` |
| `files` | `lyra-files-core`（见 [native-core-path.md](native-core-path.md)），不是 `lyrad` |
| `browser` | `lyra-browser-service` + `LyraBrowserApi`（见 [lyra-browser-service.md](lyra-browser-service.md)），不是 `lyrad` |

`lyrad` 现在还有 `performance.`。它不是本项 Core 名单，也不是 OS 壳。不要借机扩路由。

files / image / docs / a11y 的 crate 配对仍以 [native-core-path.md](native-core-path.md) 为准。`browserShell` 是工作区 layout（见 [browser-shell-layout.md](browser-shell-layout.md)），不是引擎，不要并进 Core 名单。

## 这台机器的壳（换壳另接）

| 适配 | `LyraDesktopApi` 字段 | 当前 Electron 实现 |
| --- | --- | --- |
| 窗口材质 | 无独立字段；窗口创建时直接设 | `apps/desktop/src/main/window-material.ts`（vibrancy / mica） |
| 通知 | `systemNotifications` | `apps/desktop/src/main/system-notifications/service.ts` |
| `safeStorage` | `auth` / `sensitiveValues` / `loginManager` 密码 | Electron `safeStorage` |
| auto-update | `appUpdate` | `apps/desktop/src/main/auto-update/service.ts`（`electron-updater`） |
| location | `location` | `apps/desktop/src/main/location/service.ts` |
| 登录态 cookie 保险库 | `loginManager` | `login-manager/site-data.ts`（`session.cookies`）+ `password-vault.ts` |

这些实现现在还在 Electron 里。用户看到的窗口、通知、登录保存不会变。不要把它们搬进 `lyrad`，也不要假装已经是 Core。

## 不是本契约

- 把 `LyraDesktopApi` 拆成两套 preload / IPC
- 把窗口材质、通知、钥匙串、更新、定位、cookie 保险库做成 daemon 方法
- 换桌面壳或另起浏览器引擎进程

看守：`apps/desktop/src/shared/core-api-os-shell.test.ts`。`lyrad` 不得路由 `window.` / `notification.` / `safeStorage.` / `appUpdate.` / `location.` / `login.` / `auth.`。
