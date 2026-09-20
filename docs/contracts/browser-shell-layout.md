# Browser shell layout

Audience: Internal
Status: Active
Last verified: 2026-09-19

`browserShell.syncLayout` 的矩形是工作区坐标，不是 DOM `getBoundingClientRect` 协议。
谁是壳，谁提供矩形。引擎按这份 snapshot 钉页面，自己不量 DOM。

清单在 `apps/desktop/src/shared/browser-shell-api.ts`。看守：`apps/desktop/src/shared/browser-shell-api.test.ts`。

## 坐标系

- `coordinateSpace`: `workbench`
- 原点：工作区表面左上角（Electron：渲染进程视口 / `BrowserWindow` contentView）
- 单位：该表面的 CSS 像素
- 表面尺寸：`windowWidth` / `windowHeight`

页面矩形是 `x` / `y` / `width` / `height`。数字已经是工作区坐标。

## 壳方法

`BROWSER_SHELL_METHODS`：syncTopology、syncLayout、setChromePopover、setModalOcclusion、onEvent。

## Electron 适配

`apps/desktop/src/modules/workbench/shell/browser-layout-sync.ts` 仍可用 `getBoundingClientRect`，因为 Electron 的工作区就是渲染视口。量完必须经 `toWorkbenchLayoutBounds` 再 `syncLayout`。

`apps/desktop/src/main/workbench-browser/view-manager-runtime/layout-controller.ts` 把工作区坐标 1:1 交给 `setBounds`。那是 Electron 适配，不是契约。

旧 session snapshot 没有 `coordinateSpace` 时，sanitize / normalize 写成 `workbench`。

## 不是本项

- 引擎离开 Electron 进程（见 [lyra-browser-service.md](lyra-browser-service.md)）
- `setChromePopover` 的 `anchorRect` 形状仍是 left/top/right/bottom；Electron titlebar 仍从 DOM 填，但坐标同样是工作区表面
