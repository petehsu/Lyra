# Renderer Styles Guide

Lyra Desktop renderer 样式现在只有一条入口和一套分层：真实颜色值集中在 token 源，页面和组件只消费 `--lyra-app-*`、`--lyra-text-*`、全局尺寸 token 和 App 组件规则。旧 `renderer/styles/workbench/*.css` 聚合体系已物理删除，不再作为兼容层保留。

## 入口顺序

`apps/desktop/src/renderer/main.tsx` 只导入字体和 `styles/index.scss`。字体入口为：

- `@fontsource/geist-sans`
- `@fontsource/geist-mono`
- `@fontsource-variable/noto-sans-sc`

`index.scss` 是唯一样式入口，顺序固定为：

1. `tokens.css`：基础设计 token、字体族、间距、圆角、字号、状态色、阴影。
2. `tailwind.css`：Tailwind v4 与 shadcn/ui 颜色角色 bridge。
3. `base.css`：全局 reset、默认字体、统一滚动条。
4. `material.scss`：唯一产品视觉颜色源，维护 `--lyra-app-*`、材质、theme preview、effect/code/diff/skeleton 等真实颜色 token。
5. `app-ui.scss`：Button/Input/Select/Switch/Tabs/Menu/ObjectRow/Badge/State/DataTable/Tooltip/Dialog/Toast/CommandMenu/WindowButton 等 App 组件视觉。
6. `shell.scss`：App Shell、titlebar、browser tabs、context menu、omnibox、panel/resizer 等外壳布局。
7. `surfaces.scss`：Settings、Software Store、File Manager、Notification Center、Login Manager、History、Browser/Search、File Editor、Image Viewer、Terminal 等业务 surface 布局。
8. `agents.scss`：AI Panel / Lyra Agents、agent-git、agent-project-tree、agent-selfdev、agent-overnight、agent-session-history 布局。
9. `effects.scss`：animated magic border、shimmer、skeleton/pattern 等可复用效果。

不要在 `main.tsx` 或业务模块里重新拆散这些 import。

## 职责边界

- `tokens.css`
  - 只放基础 token 和全局语义 token。
  - 允许真实尺寸和基础颜色值。
- `material.scss`
  - 只放真实产品颜色值与材质/effect token。
  - `--lyra-app-*` 是全局产品视觉源；主题深浅色和 opaque fallback 必须在这里闭环。
  - `--lyra-app-material-*` 是页面和 App 组件可消费的材质入口，用来承接 shell、sidebar、toolbar、panel、popover、overlay 的模糊背景、边框和降级值。
  - `--material-*` 是 `material.scss` 内部底层 token，不作为页面控件、列表、输入框的视觉来源。
  - macOS/Windows 默认尝试系统材质；Linux 默认 opaque 保证可用性，只有设置 `LYRA_ENABLE_LINUX_WINDOW_MATERIAL=1` 才启用实验透明窗口。`LYRA_DISABLE_WINDOW_MATERIAL=1` 会强制 opaque fallback。
- `tailwind.css`
  - 只做 Tailwind v4 token bridge，不写页面视觉。
- `base.css`
  - 只做全局元素 reset、字体、滚动条；不得写页面规则。
- `app-ui.scss`
  - 只放跨页面 App 组件状态和视觉。
  - 按钮、输入框、菜单、列表行、状态、表格、tooltip、dialog、toast、command menu、window button 的 hover/focus/active/disabled 统一在这里。
- `shell.scss`
  - 只放窗口外壳、titlebar、tabs、omnibox、context menu、workspace/panel/resizer 的布局与组合。
- `surfaces.scss`
  - 只放业务页面布局、surface 排列、响应式规则。
  - 不重新定义基础 button/input/list/badge/status 视觉。
- `agents.scss`
  - 只放 Lyra Agents 和剩余 agent surfaces 的布局与消息/tool/permission/decision 组合。
  - 不允许 AI Panel 模块目录内再出现本地 CSS 或本地 token。
- `effects.scss`
  - 只放可复用效果实现；颜色必须来自 `material.scss` token。

## 组件消费规则

- 业务页面只能消费 `@renderer/ui/components`、`@renderer/ui/app`、`@renderer/ui/layout`。
- shadcn/ui 源码组件只放在 `@renderer/ui/primitives`，业务页面不要直接 import。
- Radix primitive 先包装成 Lyra App 组件再使用。
- 通用图标语言统一用 `lucide-react`，Lyra logo 例外。

## 颜色规则

- 真实颜色值只允许出现在 `tokens.css` 和 `material.scss`。
- `app-ui.scss`、`shell.scss`、`surfaces.scss`、`agents.scss`、`effects.scss`、`base.css`、`tailwind.css` 禁止出现 `#hex`、`rgb()/rgba()`、`hsl()/hsla()`、`oklch()`。
- 品牌、theme preview、skeleton/shimmer、code block、diff、popover shadow、scrollbar alpha 等特殊颜色也必须先进入 `material.scss` token。
- 禁止恢复 `--lyra-bg-*`、`--lyra-line-*`、旧 browser tab 背景 token；页面和 token 源都不能再定义或消费。
- 页面级 `--lyra-<page>-bg/card/row/input/border/focus` 只能 alias 到 `--lyra-app-*` 或作为非视觉布局 token，不能定义真实色值。

## 视觉规则

- 中性色负责主体界面；Primary 只用于关键操作、当前选中和焦点。
- 每个可交互控件都要覆盖 default、hover、active/selected、focus、disabled，必要时覆盖 loading。
- Boolean 设置项必须用 `AppSwitch`，不用两个 choice card 模拟开关。
- 枚举项默认用 `AppSelect` 或 `AppTabs`，不再扩散 text-button 和局部列表样式。
- 可选中的业务对象列表优先使用 `AppObjectRow`，状态标签用 `AppBadge`，页面级反馈用 `AppStatusMessage`。
- 命令入口用 `AppCommandMenu`，弹窗表面用 `AppDialog`，组件级 toast 行用 `AppToast`；产品级操作反馈优先走现有 Notification service 或 inline `AppStatusMessage`。
- Icon-only 小控件只表达 glyph state：hover/active/open 只变图标颜色或透明度，不新增小块背景。顶栏入口、tab close、删除/打开图标、dialog/toast close、模型/provider 小图标都遵守这条。
- 有容器语义的控件才表达 surface state：设置导航项、列表行、菜单项、输入框、choice/card、tab 本体可以有 hover/selected 背景。
- 固定格式 UI 要有稳定尺寸，避免 hover、图标、标签或动态文案导致布局跳动。

## 校验

- UI 样式守卫：`pnpm --filter @lyra/desktop lint:ui-style`
- Desktop 类型检查：`pnpm --filter @lyra/desktop typecheck`

`lint:ui-style` 由 `tools/verify-workbench-style.ts` 扫描：

- `apps/desktop/src/renderer/styles/**/*.{css,scss}`
- `apps/desktop/src/modules/workbench/**/*.css`
- `apps/desktop/src/modules/workbench/**/*.ts(x)` 中的 inline style 和 UI import 边界

它会检查旧样式目录是否被恢复、受保护选择器、裸长度字面量、非 token 源 raw color、inline style 裸视觉字面量、断点白名单、App 组件消费边界，以及旧视觉 token 消费。Workbench 业务 TSX 默认禁止裸 `<button>/<input>/<select>/<textarea>`；只有 `renderer/ui/components`、`renderer/ui/primitives` 和测试文件可以拥有底层控件实现。
