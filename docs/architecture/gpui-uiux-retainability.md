# Lyra UI/UX → GPUIX 迁移可保留性检查

Audience: Internal
Status: Check
Last verified: 2026-09-19

这次只检查「迁到 GPUIX 之后，现有视觉、布局、交互能不能尽量留下」，不改代码，不重做设计，不另开桌面框架。

目标架构已确定：

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

GPUIX 以 [remorses/gpuix](https://github.com/remorses/gpuix) README 为能力上限（2026-09-19 核对）：React reconciler 画到 GPUI，**没有 Electron、没有 DOM、没有 CSS 文件**。它能留 React 的 hooks/状态，不能留 React DOM 和现有 SCSS。

和 [gpui-cef-migration-fitness.md](gpui-cef-migration-fitness.md) 的分工：那份看架构能不能平滑换壳；这份看用户能不能认出同一套 UI。开始前要冻的接口见 [gpui-migration-prework.md](gpui-migration-prework.md)。

---

## 结论

**视觉骨架可以接近，产品手感不能 1:1。** 用户会明显感觉换了一套 UI。不是因为侧栏/顶栏/分栏做不出来，而是因为现在的「漆」和三块 Web 宿主搬不过去：玻璃叠层、contentEditable Composer、Monaco / xterm。

| 问题 | 一句话 |
| --- | --- |
| 哪些 UI/UX 可以基本原样复现 | 栏、轨、间距、实色 hover、分栏比例、文件树、Settings 表单、Agent 定高 diff 列表 |
| 哪些业务/状态逻辑可以直接保留 | Desktop API 调用、会话/工具 store、树可见行算法、diff 扁平化、快捷键状态机、i18n、tab/workspace 模型 |
| 哪些 DOM/CSS/Web 依赖必须重写 | 全部 SCSS/Tailwind/className、Radix portal、Monaco、xterm、Streamdown+KaTeX+Mermaid、contentEditable、HTML5 DnD、`getBoundingClientRect` 驱动的 Browser 嵌入 |
| 哪些效果 GPUIX 当前做不到 1:1 | 逐层 `backdrop-filter`、`color-mix` 半透明、CSS `@keyframes` / `mask-image` / `conic-gradient`、KaTeX/Mermaid、Monaco 编辑手感、xterm 终端、chip+IME Composer |
| 迁移成本最大的区域 | ① Monaco+GPU overlay ② xterm ③ Composer+引用芯片 ④ 2.2 万行 SCSS 材质/动效 ⑤ Browser chrome 与 CEF 的布局同步 |

可保留比例（按当前仓库抽样，见第 4 节）：

```text
业务逻辑：约 75% 可保留
React 组件结构：约 50% 可保留
视觉样式：约 20% 可直接保留
实际渲染代码：约 25% 可保留
```

---

## 1. UI 技术依赖

扫描范围：`apps/desktop/src/{renderer,modules}`、`apps/desktop/package.json`、`packages/icons`、`packages/workbench-ui-runtime`。

| 依赖 | 规模 | React 逻辑还是 DOM/浏览器 | 迁 GPUIX |
| --- | --- | --- | --- |
| React / React DOM | desktop 约 282 个文件 `from 'react'`；`renderer/main.tsx` `createRoot` | hooks/状态可留；`react-dom` 是宿主 | GPUIX 换 `jsxImportSource: "@gpuix/react"`，丢掉 `react-dom` |
| CSS / SCSS | `renderer/styles/` **11** 个文件、**22362** 行；无 CSS Modules | 全是 CSSOM | 不能 import。token **数字**可搬进 `style` 对象 |
| Tailwind v4 | `tailwind.css`；约 102 文件 utility className | DOM class | 整层丢掉 |
| Radix | 10 个 `@radix-ui/*`；`renderer/ui/primitives/` 9 文件 | Portal、焦点陷阱、ARIA | 语义对照 GPUIX headless Select/Tooltip；实现重写 |
| Monaco | `file-editor/monaco*.ts`、`use-file-editor-runtime.ts`、`renderer/gpu/gpu-overlay.ts` | 挂 HTMLElement + worker；GPU overlay 还叠 WebGPU canvas | 必须换。GPUIX `<code>` 是只读高亮块，不是 IDE |
| xterm | `terminal-dock/pane-surface.tsx` + FitAddon | canvas/DOM 终端 | PTY 可留；绘制必须换 |
| Markdown | `LyraMarkdown.tsx` + streamdown + `@streamdown/{cjk,code,math,mermaid}` + KaTeX + Shiki | HTML 管线 | 预处理纯函数可留；渲染换 GPUIX `<markdown>`，数学/图会降级 |
| Diff | Agent：`VirtualizedDiffView.tsx` 自研；编辑器：Monaco DiffEditor | 算法纯；Monaco 路径是 DOM | Agent diff 可对 GPUIX `<diff>`；编辑器 diff 跟 Monaco 一起走 |
| 图标 | `@lyra/icons`，desktop ~86 文件引用 | SVG React / Iconify | 文件名映射可留；改 GPUIX `<svg source>` |
| 动画库 | **无** framer-motion 等 | CSS `@keyframes` / `transition` / `effects.scss` | 无包袱；效果用 GPUIX `motion.div` 重做，能力更窄 |
| 虚拟列表 | **无** react-window；自研 `visible-rows.ts`、`VirtualizedDiffView` | 切片算法纯；视口靠 ResizeObserver | 算法可留；绑 GPUIX `<virtual-list>` |
| Portal / overlay | `createPortal`：`context-menu/view.tsx`、`titlebar-navigation.tsx`；其余走 Radix Portal | DOM | 换 GPUIX `<anchored>` |
| DOM 测量 | `getBoundingClientRect` ~46 文件；`ResizeObserver` ~24；`MutationObserver` 4；`canvas.measureText` 3 | 浏览器 | 必须换 GPUI 布局/文本度量 |
| Canvas / SVG / WebGPU | `gpu-overlay.ts`、`glyph-rasterizer.ts`、`image-viewer`、icons | Web 绘制 | GPUIX `<canvas>` README 仍为 **planned** |
| 未真正使用 | xyflow 仅类型桩；`dagre` / `@novnc/novnc` / `darkreader` 源码几乎无引用 | — | 不影响 |

**只是 React 逻辑：** `stream-store.ts`、`visible-rows.ts`、`flattenDiffHunks` / `diffVisibleLineRange`、`markdown-stream-split.ts`、`normalize-ai-latex.ts`、`file-search.ts`、layout/tabs zustand、`LyraDesktopApi` 调用。

**实际依赖 DOM：** 所有 `.tsx` 的 `className`、Monaco/xterm/Streamdown/Radix、测量与 portal、contentEditable Composer。

---

## 2. 视觉保留能力

判定：

1. GPUIX 能接近 1:1（用户不太会觉得换皮）
2. 功能能做，但会像重做一套 UI
3. 当前 GPUIX 能力下无法 1:1，或必须换宿主

GPUIX 已有：flex/grid、`borderRadius`、`boxShadow`、`opacity`、`overflow: scroll`、窗口 `windowBackground: "blurred"`（macOS vibrancy）、`hover`/`active` 样式、`motion.div` 数值过渡、原生 `<markdown>` / `<code>` / `<diff>` / `<virtual-list>`。

GPUIX README **没有**：CSS 文件、`backdrop-filter`、`filter`、`color-mix`、`@keyframes`、`mask-image`、`conic-gradient`、逐元素毛玻璃。模糊只在**整窗** vibrancy。

| 表面 | 判 | 依据 |
| --- | --- | --- |
| Sidebar | 1 结构 / 2 材质 | `surfaces.scss` 网格可复刻；`material.scss` `blur()` + `saturate(1.35)` + `color-mix` 不能逐层搬 |
| Title bar | 1 网格 / 2–3 拖窗 | `shell.scss` 列网格可做；`-webkit-app-region: drag` 是 Electron；GPUIX 有 transparent titlebar |
| Chat | 2 | `agents.scss` 8071 行；`mask-image` 渐隐、`stagger-in` / tick `@keyframes`、`scrollIntoView({behavior:"smooth"})` |
| 输入框 / Composer | 3 | `CitationComposerInput.tsx` **contentEditable** + chip DOM（`citation-chip-dom.ts`）。GPUIX `<textarea>` 有 IME，没有内嵌芯片选区 |
| 工作区 / split | 1 | `use-panel-layout.ts` 尺寸状态可迁；视觉是分栏+resizer |
| 文件树 | 1 | `visible-rows.ts` + 实色行；无复杂 CSS 特技 |
| Search / Settings | 1–2 | 表单/列表可迁；`@media` 断点与 `color-mix` 卡片会变 |
| Terminal | 3 | xterm。GPUIX 无终端控件 |
| Editor | 3 | Monaco + 可选 WebGPU overlay。GPUIX `<code>` 只读、固定行高、语言子集（Rust/TS/JS/Python/Go/JSON/Bash/TOML/YAML/Markdown/HTML/CSS/C） |
| Agent Diff | 1 | 定高虚拟列表 ↔ GPUIX `<diff>` |
| Markdown | 2–3 | GPUIX GFM（标题/列表/表格/围栏代码）；Lyra 还有 KaTeX、Mermaid、Shiki、`details/summary` 再解析 |
| Browser chrome | 2 条 / 3 页 | 条可重画；页在 CEF。现有 `browser-layout-sync.ts` 用 DOM 矩形钉 `WebContentsView` |
| 弹窗 / 菜单 / Tooltip | 2 | Radix Portal vs GPUIX `anchored`；token 阴影可近似，焦点陷阱手感会变 |
| 圆角 / 阴影 | 1 | GPUIX 支持 `borderRadius`、`boxShadow`；`tokens.css` 数字可搬 |
| blur / 透明 | 2 | `tokens.css` 里 `--lyra-backdrop-blur-*: none`，真正模糊在 `material.scss` `--material-blur-sm/md/lg` + `window-material.ts` vibrancy/mica。整窗毛玻璃可接近，**控件背后实时透视** 难 1:1 |
| 动画 | 2 | GPUIX `motion.div` 只做数值插值，无 spring / keyframes / shared-layout。`effects.scss` magic-border 的 `conic-gradient` + `mask-composite` 做不到 |
| responsive | 2 | 多处 `@media (max-width: 980/1180px)`，GPUIX 要手写断点 |

**用户会不会觉得换了一套 UI？会。** 骨架还在，玻璃、动效、编辑器、终端、Composer 芯片一换，就是另一层漆。

---

## 3. 交互保留能力

| 交互 | 判 | 现有实现依赖的浏览器行为 |
| --- | --- | --- |
| hover / active | 1 | 实色 token；GPUIX 原生 `style.hover` / `style.active` |
| keyboard shortcut | 1 | `shell/service.ts` 状态机；监听从 `window.keydown` 换成 GPUIX `onKeyDown` |
| focus | 2 | Radix trap / Monaco / xterm focus。GPUIX 是 `FocusHandle`，不是 DOM tabindex 生态 |
| 中文 IME | 2 普通输入 / 3 Composer | GPUIX `<input>`/`<textarea>` README 写明 IME composition。Composer 用 `contentEditable` + `isComposing` + chip，不是原生 textarea |
| 文本选择 | 2–3 | 全局 `user-select: none`，白名单 input/contenteditable/xterm（`shell.scss`）。Chat 复制走 `getSelection` |
| copy / paste | 2–3 | `navigator.clipboard`；Composer `clipboardData` 插图/URL chip |
| undo / redo | 3 | Composer 靠浏览器 contentEditable 历史，无自研栈；Editor 靠 Monaco |
| drag & drop | 3 | HTML5 `DataTransfer`（Composer、tab strip、terminal tabs）；`files.getPathForFile(File)` |
| resize / split panes | 1 | 指针几何 + 状态；不靠 CSS `resize` |
| context menu | 2 | `createPortal` + `getBoundingClientRect` 避让 Browser host |
| tooltip / popover / modal | 2 | Radix；GPUIX 有 Tooltip / anchored，无 Radix 行为副本 |
| multi-select | 1–2 | 组件语义，不是 OS 多选 |
| scroll / smooth scroll | 2–3 | GPUI 有原生滚动；无 CSS `scroll-behavior: smooth` / `overscroll-behavior` 等价物保证 |
| virtualized list | 1 | 自研算法 + GPUIX `<virtual-list>` |
| tab / workspace 切换 | 1 | 状态可迁；拖拽重排属 DnD，判 3 |
| 文件/图片拖入 | 3 | `File` + Electron `webUtils` |
| 多屏 / DPI | 2 | `devicePixelRatio`；Browser 页在 CEF 内可保留 |
| accessibility | 2 | 大量 `aria-*` / Radix。GPUIX/GPUI 是另一套无障碍模型，DOM ARIA 不搬 |

---

## 4. React 代码可保留程度

不要说「React 可以保留」。GPUIX **保留 React 运行时，不保留 React DOM**。`jsxImportSource` 必须改成 `@gpuix/react`；`className`、`document`、DOM `ref` 全部失效。

计数基线（`apps/desktop/src/modules` + `renderer`，不含测试文件名）：约 **395** 个 `.ts`、**202** 个 `.tsx`。`.tsx` 几乎都带 `className`。样式权威入口见 `renderer/styles/README.md`。

### A. 可直接保留（约 75% 业务逻辑）

hooks / state / reducer / store / 数据转换 / 不碰 DOM 的业务：

- `agent-session-view-model/stream-store.ts`
- `agent-project-tree/visible-rows.ts`、`file-search.ts`
- `VirtualizedDiffView` 的 `flattenDiffHunks` / `diffVisibleLineRange`
- `normalize-ai-latex.ts`、`markdown-stream-split.ts`
- `layout/service.ts`、`tabs/service.ts`、panel 尺寸算法
- i18n 字典、`window.lyraDesktop` 的调用形态（桥要换传输，不换语义）
- 快捷键映射、workspace 恢复、session tabs

会被拖下水的「看起来像逻辑、其实在量 DOM」：`use-panel-layout.ts`、`use-anchored-overlay-position.ts`、`browser-layout-sync.ts`、`use-auto-scroll.ts`、`text-metrics/engine/measurement.ts`。

### B. 可部分保留（约 50% 组件结构）

组件切分、props、事件流向、组合关系可以对照着搬：`ChatView` / `Composer` 外壳、`workspace-surface-router`、project-tree 行模型、Settings 分区、AppDialog 的「开/关/标题」语义。

不能原样保留：JSX host（`div`/`span`/`button` 的 HTML 含义）、`className` 契约、Radix 组合件、`forwardRef` 到 DOM。GPUIX 的 `div` 是 flex 容器，文本必须走 `<text>`，颜色还不继承。

### C. 基本必须重写（约 80% 视觉、约 75% 渲染代码）

- 全部 SCSS/Tailwind（22362 行）
- Monaco 运行时 + `gpu-overlay.ts` WebGPU
- xterm `pane-surface.tsx`
- Streamdown / Shiki / KaTeX / Mermaid
- `CitationComposerInput` + `citation-chip-dom.ts`
- Radix primitives 与 `createPortal`
- `getBoundingClientRect` / `ResizeObserver` / `MutationObserver` / `document.body`
- Browser `syncLayout` 嵌入模型

综合：

```text
业务逻辑：约 75% 可保留
React 组件结构：约 50% 可保留
视觉样式：约 20% 可直接保留   （token 数字；规则本身 ≈ 0%）
实际渲染代码：约 25% 可保留   （列表/表单/chrome 骨架；三大 Web 宿主除外）
```

20% 视觉不是「五分之一 SCSS 能 copy」，而是色板、间距、圆角、阴影数值能进 GPUIX `style`；其余选择器、伪类、媒体查询、材质、动效都要按 GPUIX 子集重写。

---

## 5. 迁移成本最大的区域

1. **代码编辑器（Monaco + GPU overlay）**  
   IDE 级编辑、DiffEditor、IME、装饰器、Find，外加 WebGPU 字形叠层。GPUIX `<code>` 覆盖不了。成本最高。

2. **终端（xterm）**  
   渲染面与 FitAddon/测量全绑 DOM。PTY 在 Rust Core，绘制要新做。

3. **Composer（contentEditable + 芯片）**  
   引用/图片/文件芯片、选区、粘贴、拖入、IME 空格转链，全部是 DOM Selection。GPUIX textarea 只能接「纯文本草稿」，芯片交互要重做。

4. **视觉系统（2.2 万行 SCSS + 材质）**  
   `agents.scss` 8071 + `surfaces.scss` 7152 + `shell.scss` 2306 + `app-ui.scss` 2733。玻璃、`color-mix`、keyframes、magic-border 是观感差异的主因。

5. **Browser chrome × CEF 布局同步**  
   `browser-layout-sync.ts` 把 DOM 矩形推给 Electron `WebContentsView`。独立 Browser Service 后，页还在 CEF，但「钉子」协议必须换；tab 拖拽幽灵图是 HTML DnD。

次一级：Streamdown 富文本（数学/图）、Radix 叠层、图标 SVG 管线。这些能做出功能，但版式对不齐。

---

## 分桶（给迁移排期用）

**基本可原样复现**

- Shell 几何：侧栏宽、底栏高、分栏、resizer
- 文件树、Problems 列表、Agent 工具 diff
- Settings / Store / Login 的表单流
- 实色 hover、圆角、阴影数字、快捷键、workspace 切换

**逻辑可留、皮要重画**

- Chat 列表（用 `<virtual-list>`）
- GFM Markdown（用 `<markdown>`，丢掉 KaTeX/Mermaid/details 再渲染）
- Tooltip / Dialog / Menu（对照 GPUIX anchored）
- 图标名到资源的映射
- 整窗 vibrancy（不是逐控件 `backdrop-filter`）

**必须重写或接受明显降级**

- Monaco、xterm、contentEditable Composer
- SCSS/Tailwind/className
- HTML5 DnD 与 `File` 路径
- Streamdown 插件链
- DOM 测量驱动的 Browser 嵌入
- CSS 关键帧与 magic-border

**不影响 UI 1:1 的现有代码**

- `lyrad` / Agent / files-core 等 Rust Core（见架构友好度报告）
- 未使用的 xyflow / dagre / novnc / darkreader
- 测试里的 jsdom mock

---

## 证据来源

- Lyra：`apps/desktop/package.json`、`renderer/styles/*`、`file-editor/`、`terminal-dock/pane-surface.tsx`、`CitationComposerInput.tsx`、`LyraMarkdown.tsx`、`VirtualizedDiffView.tsx`、`window-material.ts`、`browser-layout-sync.ts`
- GPUIX：仓库 README「Supported Elements / Styles / Text input / Native animations / Status」（无 DOM、无 CSS 文件、无逐元素 backdrop-filter、无 canvas、`<code>` 非 IDE）
