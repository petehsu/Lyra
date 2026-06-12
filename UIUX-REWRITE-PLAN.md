# Lyra UI/UX Native Rewrite Plan

## 目标

这次不是修补现有 CSS，也不是局部美化，而是在可回退分支上做一次完整的 UI/UX 与前端样式技术栈重构。

目标是把 Lyra Desktop 从“多个独立手写界面拼在一起”重构成一个统一、可商业化发布的工作台产品。所有核心界面都要共享同一套设计语言、组件规范、图标语言、布局骨架、状态规则和 Design Token。

重构的含义：

- 不是保留旧 DOM 和旧 class 后局部补样式。
- 不是只把颜色、圆角、阴影替换成新 token。
- 不是把 shadcn/ui 当成一套默认皮肤直接套到旧页面上。
- 是允许按新设计系统重新组织组件层级、页面结构、交互控件和样式边界。
- 是每个 surface 迁移时都要从“这个界面应该由哪些统一 App 组件组成”重新设计，而不是沿用旧页面的写法。

本规划文档只描述重构方案，不包含代码实现。

## 分支与回退策略

重构必须在独立分支完成，不直接污染 `main`。

建议分支：

```text
codex/uiux-rewrite-plan
codex/uiux-native-rewrite
```

回退原则：

- `main` 保持可用。
- 每个阶段都能独立提交。
- 每个阶段完成后至少保留一次可运行截图和测试结果。
- 大规模删除旧 CSS 前，必须先有新组件体系覆盖对应界面。
- 不在同一个提交里同时做“技术栈引入、视觉重构、业务逻辑改动”。

## 目标技术栈

桌面端 UI 目标栈：

- Tailwind CSS：作为主要 utility layer 和 token 消费层。
- shadcn/ui：采用源码集成方式，作为统一基础组件来源。
- Radix UI：作为无样式交互基础设施，承担 Dialog、Popover、Dropdown、Select、Tabs、Toast 等复杂交互。
- SCSS：用于全局 token 输出、Electron/workbench 特殊布局、复杂层级结构和少量无法优雅 utility 化的样式。
- lucide-react：作为统一图标语言。
- Geist：作为 UI 主字体。
- Noto Sans SC：作为中文字体。
- Geist Mono：作为代码字体。
- Lyra 自有 Logo：保留自有品牌符号，不并入通用 icon set。

开源组件库使用方式：

- shadcn/ui 作为源码集成的基础组件来源，不作为最终品牌视觉的全部答案。
- Radix UI 负责可访问性、键盘交互、Popover/Select/Dialog/Tabs 等复杂行为，不直接暴露给业务页面。
- Lyra 业务页面只消费 `renderer/ui/components`、`renderer/ui/app`、`renderer/ui/layout`。
- `renderer/ui/primitives` 保留 shadcn/Radix 的组合方式和基础结构。
- `renderer/ui/components` 才是 Lyra 的产品级组件层，负责统一尺寸、密度、icon、状态、motion、loading、disabled、focus、错误态。
- 如果某个交互在 shadcn 默认组件里不够精细，应该在 primitive 或 App wrapper 中扩展，而不是让业务页面重新手写一套。

明确不再继续扩大当前模式：

- 不再每个模块手写一套按钮、卡片、列表、标签页。
- 不再让 AI 面板维护一套独立 demo token。
- 不再用局部 CSS class 随手定义 hover、selected、disabled。
- 不再把页面级布局、组件状态、视觉变量混在一起。

## 旧视觉系统废止规则

设置页精调后的视觉语言已经升级为 Lyra 全局 App Theme。后续只有 `--lyra-app-*` 能作为产品视觉源。

旧系统处理方式：

- `--lyra-bg-*` 已物理删除，不再作为主题源，也不保留兼容 alias。
- `--lyra-line-*` 已物理删除，不再作为边框/焦点源，也不保留兼容 alias。
- `--material-*` 只表示窗口材质、毛玻璃、opaque fallback，不作为页面控件视觉源。
- `--lyra-browser-tabs-bg`、`--lyra-browser-tab-bg`、旧 `--lyra-tab-*` 背景 token 已物理删除。
- 页面、组件、业务 TS 禁止继续消费 `--lyra-bg-*`、`--lyra-line-*`、旧 browser tab 背景 token。
- `--material-*` 只允许在 `material.scss` 与 `app-ui.scss` 的系统材质外壳使用。
- 新增页面、新增组件、新增样式默认不允许引入新的 page-local bg/card/row/input/border/focus token。
- Terminal 不能再在 theme preset 里维护独立固定配色；xterm 背景、前景、cursor、selection 必须从 `--lyra-app-*`、`--lyra-text-*` 和 state token 派生。

也就是说：旧 token 不再存在。产品视觉只认 `--lyra-app-*` 和 Lyra App 组件。

## 产品视觉方向

Lyra 应该像一个专业 AI workbench，而不是网页、浏览器、IDE、聊天 demo 的拼接。

当前主参考方向已经收敛为 Cursor 式现代桌面工具：

- 稳重、克制、低噪音，而不是玩具感、轻飘感或彩色 demo 感。
- 中性灰阶承担大部分界面层级，品牌色只用于必要的关键操作或焦点，不让 hover 到处变蓝。
- 列表、设置项、选择器、输入框要有成熟桌面软件的密度和边界感。
- 毛玻璃和半透明主要用于窗口外壳、侧栏、工具栏、浮层，不把内容区做成大面积玻璃。
- 交互要像桌面软件：hover、focus、selected、disabled、popover 方向、点击外部关闭、点击另一个控件直接切换，都要稳定。

Cherry Studio 和 Zen 仍作为“现代感、系统材质、轻外壳”的辅助参考，但视觉精度和设置页/列表/输入控件的主要标尺改为 Cursor。

关键词：

- 安静但有层级。
- 工具型，但不粗糙。
- 高密度，但不拥挤。
- 稳重但不死沉。
- 现代但不轻浮。
- 同色系分层，但不能糊成一片。
- 清晰交互状态，而不是靠用户猜。
- 统一组件语言，而不是每个页面重新设计。

## 从 UI/UX 基础视频吸收的原则

视频里最重要的设计原则是：UI 本身应该传达关系、层级、状态和可操作性，而不是依赖说明文字。

这些原则必须进入 Lyra 的重构标准。

### 关系与分组

用户应该能通过视觉立即理解哪些元素属于一组。

规则：

- 容器表示一组内容。
- 间距接近表示关联更强。
- 分割线表示区域边界。
- 背景层级表示父子结构。
- 标题、列表、卡片、工具栏必须有稳定组合方式。

应用到 Lyra：

- AI 面板中的消息、工具调用、权限请求、附件必须各自有明确容器。
- 设置页的选项组必须比单个选项更明显。
- 软件商店卡片必须统一展示图标、标题、描述、状态和操作。
- 通知列表与通知详情不能像两块随意拼接的区域。

### 层级与重要性

信息重要性应该通过尺寸、位置、颜色、重量和距离表达。

规则：

- 最重要的信息放在区域顶部或视觉起点。
- 主要信息更大、更重、更清晰。
- 次要信息更小、更弱、更靠下。
- 操作按钮和状态信息不能抢正文主信息。
- 列表中的主文本、辅助文本、meta 信息必须有固定层级。

应用到 Lyra：

- 文件名比路径重要。
- 当前 tab 比未激活 tab 重要。
- 当前 AI 任务状态比历史 meta 重要。
- 错误和权限请求比普通工具日志重要。
- 设置项名称比说明文字重要。

### 状态可见性

每个可交互元素都必须表达当前状态。

最低状态集合：

```text
default
hover
active / pressed
selected
focus-visible
disabled
loading
error
warning
success
```

应用到 Lyra：

- Tab 必须明确区分 inactive、hover、active、dragging。
- Button 必须明确区分 default、hover、pressed、disabled、loading。
- Input 必须明确区分 default、focus、filled、error、disabled。
- Sidebar item 必须明确区分 default、hover、active、disabled。
- Tool call 必须明确区分 queued、running、success、failed、cancelled。

### 暗色模式层级

视频里提到暗色模式不能像亮色模式那样主要依赖阴影。Lyra 的暗色模式必须主要依赖背景层级、边框强弱和前景亮度。

规则：

- 深色背景之间必须有可感知差异，但不能跳色。
- 卡片应比页面背景略亮。
- 浮层应比卡片更亮或边框更强。
- 高亮 chip 不应该过亮。
- 边框在暗色模式下要降低对比，避免显脏。
- 阴影只用于浮层和极少数需要脱离背景的元素。

### 颜色语义

颜色必须有目的，不应该只是装饰。

语义规则：

- Brand / Accent：当前焦点、主操作、链接、关键选中态。
- Blue：信任、信息、可跳转。
- Green：成功、完成、可用。
- Yellow：警告、等待确认、需要注意。
- Red：危险、错误、删除、失败。
- Muted：禁用、历史信息、低优先级 meta。

应用到 Lyra：

- AI 工具运行中不能和错误状态共用同一颜色。
- 删除、清空、拒绝权限必须使用 destructive 语义。
- 成功 toast、失败 toast、警告 toast 必须颜色语义一致。
- 搜索结果来源、软件状态、通知状态不能随意用装饰色。

### 图标与文本关系

图标应该辅助理解，而不是制造噪音。

规则：

- 图标大小应接近文字 line-height，而不是随意放大。
- 工具栏图标默认 `14px`。
- 常规按钮图标默认 `16px`。
- 图标与文字间距默认 `6px / 8px`。
- 相同功能在全项目必须使用同一个图标。
- 图标不能替代必要文本，除非有 tooltip。

### 排版限制

工具型软件和营销落地页不同，不能滥用大标题。

规则：

- Workbench 内常规标题不超过 `24px`。
- 面板标题优先使用 `13px / 14px / 16px`。
- Meta 信息使用 `11px / 12px`。
- 正文使用 `13px / 14px`。
- 全产品优先使用一套 sans 字体。
- 不在不同模块随意切换字体气质。
- 大字号标题只用于官网或极少数空状态，不用于密集工作台。

### 微交互与反馈

每一次用户操作都应该有反馈。

规则：

- 点击按钮要有 pressed 状态。
- 复制成功要有 toast 或 inline feedback。
- 保存成功要有确认反馈。
- 加载中要有 loading state。
- 权限等待要有明确 pending state。
- 错误要有可读错误信息和恢复动作。
- 页面切换、菜单展开、浮层出现可以有短动画，但不能拖慢工作流。

应用到 Lyra：

- AI 发送消息后 composer 不能像无事发生。
- 工具调用开始、完成、失败都必须反馈。
- 文件操作完成必须反馈。
- 设置保存必须反馈。
- 软件安装、启用、失败必须反馈。

## 颜色与层级策略

当前问题是背景色太接近，导致用户分不清区域。解决方式不是把颜色拉得很夸张，而是建立稳定的同色分层。

核心原则：Lyra 不需要很多装饰色，需要一套清晰的颜色角色系统。不要把它理解成“页面只能有 8 个颜色值”，而是所有颜色都必须归属于少量稳定角色。

建议固定为 9 个颜色角色组：

```text
1. Background：应用最底层背景
2. Surface：页面主体、内容区域背景
3. Panel：侧栏、dock、工具区、辅助面板背景
4. Card：卡片、列表项、raised surface
5. Border：边框、分割线、focus ring
6. Text：主文字、次文字、弱文字、禁用文字
7. Primary / Accent：品牌主色、轻强调色、关键选中态
8. State：info / success / warning / destructive
9. Overlay：遮罩、popover、dialog、shadow
```

数量控制：

```text
品牌主色：1 个
辅助强调色：1 个
中性色阶：8 到 12 个
状态色：4 个
阴影/遮罩：1 到 2 组
```

真实页面中 80% 应该由中性色阶承担，Primary 和 State 只用于表达关键操作、选中、状态和风险。

### shadcn/ui 兼容 token

shadcn/ui 和 Tailwind 主题层保留这套兼容 token：

```css
:root {
  --background: ;
  --foreground: ;

  --card: ;
  --card-foreground: ;
  --popover: ;
  --popover-foreground: ;

  --primary: ;
  --primary-foreground: ;

  --secondary: ;
  --secondary-foreground: ;

  --muted: ;
  --muted-foreground: ;

  --accent: ;
  --accent-foreground: ;

  --destructive: ;
  --destructive-foreground: ;

  --border: ;
  --input: ;
  --ring: ;

  --radius: ;
}
```

这套 token 负责组件库兼容，不直接表达 Lyra 工作台的全部层级。

### Lyra workbench 扩展 token

Lyra 需要额外定义 workbench 层级 token，解决当前背景、面板、卡片、输入框、列表项颜色太接近的问题：

```text
--app-background
--shell-background
--sidebar-background
--panel-background
--surface-background
--surface-raised
--toolbar-background
--tab-background
--tab-active-background
--card-background
--list-item-background
--input-background
--hover-background
--active-background
--selected-background
--overlay-background

--border-subtle
--border-default
--border-strong

--text-primary
--text-secondary
--text-muted
--text-disabled

--primary
--primary-hover
--primary-active
--primary-muted
--accent
--accent-muted

--info
--success
--warning
--destructive
```

这套 token 负责 Lyra 桌面工作台的区域层级。

映射原则：

- shadcn token 负责基础组件默认主题。
- Lyra workbench token 负责 App Shell、Sidebar、Panel、Workspace、Toolbar、Tabs、Card、Dock 等产品层级。
- 组件内部优先使用 shadcn token。
- 页面骨架和复杂工作台区域优先使用 Lyra workbench token。
- 主题只改 token，不改组件代码。

### 颜色硬规则

- 所有页面禁止直接写颜色值。
- 所有颜色必须来自 token。
- 主题只改 token，不改组件代码。
- 主色只用于关键操作、当前选中和少量品牌焦点。
- 状态色只用于状态，不拿来做装饰。
- 中性色负责 80% 的界面。
- 每个主题必须同时设计 hover / active / selected / disabled / focus。
- 每个主题必须同时设计 light 和 dark，不允许只调一个模式。
- 状态色必须具备 foreground/background/border 三种用法。
- Overlay、shadow、ring 不允许页面局部随手写。

层级规则：

- App 背景最低，不承载内容。
- Shell 区域用于窗口框架、顶栏、底栏、侧栏。
- Surface 用于页面主体。
- Panel 用于侧栏、dock、AI 面板、工具区。
- Card 用于列表项、软件商店卡片、通知卡片、设置卡片。
- Raised Surface 用于卡片、弹窗、浮层。
- Input 背景只用于输入框、搜索框、代码输入区域。
- Selected 必须比 Hover 更明确。
- Active 必须比 Selected 更强，但不能大面积使用。

视觉分层不能只靠颜色，还要结合：

- 1px 边框。
- 少量阴影。
- 内外间距。
- 区域标题。
- 固定高度。
- 状态图标。

亮色模式建议：

- 卡片使用轻阴影或边框。
- 浮层使用更明显阴影。
- 页面背景与 surface 使用清晰但柔和的明度差。

暗色模式建议：

- App 背景最深。
- Surface 比 App 背景略亮。
- Card 比 Surface 略亮。
- Popover/Dialog 使用更强边框和轻微亮度提升。
- 避免纯白边框。
- 避免大面积高饱和色块。

## 主题收敛策略

当前 Lyra 桌面端已经有 `lyra / nova / terra / ocean / eclipse` 五个主题家族，每个家族又有 `light / dark / system`，也就是 15 个用户可见主题选项。这个数量不适合放在 UI/UX 重构关键期继续维护。

重构期主题决策：

```text
只保留一个主题家族：Lyra
只暴露三个用户选项：Light / Dark / System
实际只维护两套 token：lyra-light / lyra-dark
System 不单独设计颜色，只跟随系统解析到 Light 或 Dark
```

也就是最终保留：

```text
lyra-light
lyra-dark
lyra-system
```

阶段性下线：

```text
nova-light / nova-dark / nova-system
terra-light / terra-dark / terra-system
ocean-light / ocean-dark / ocean-system
eclipse-light / eclipse-dark / eclipse-system
```

为什么这么做：

- Cherry Studio 的参考价值在于：用户层只暴露 `light / dark / system`，复杂度放在内部 semantic token，而不是提供很多主题外观。
- Cherry Studio 的 token 结构是 neutral-first：主界面以中性色为主，`primary` 只用于真正主操作和选中态，状态色只表达状态。
- Zen/desktop 的参考价值在于反面提醒：主题色、workspace 色、渐变、color picker、light/dark 互相交织后，容易带来大量对比度、弹窗、系统模式、workspace 切换相关问题。
- UI 重构期最重要的是统一组件语言，不是做主题市场。主题越多，按钮、表格、输入框、菜单、弹窗、AI 面板、终端、软件商店卡片的验证矩阵就越大。

迁移规则：

```text
旧的 *-light 统一迁移到 lyra-light
旧的 *-dark 统一迁移到 lyra-dark
旧的 *-system 统一迁移到 lyra-system
无法识别的主题统一回退到 lyra-system
```

实施边界：

- 重构阶段从设置页、主题枚举、主题选择 UI 中移除旧主题入口。
- 不再为 nova / terra / ocean / eclipse 编写新组件适配。
- 旧主题 preset 可以在删除分支里直接移除；如果担心用户配置迁移风险，也可以先保留文件但不再导出、不再出现在设置页。
- 所有视觉验收只验收 `lyra-light` 和 `lyra-dark`，`lyra-system` 只验收系统切换行为。
- 重构完成并稳定后，如确实需要个性化主题，再通过 theme pack / marketplace / accent color 机制重新设计，而不是恢复当前 5 个主题家族。

### Lyra Light 设计方向

Lyra Light 应该是默认商业浅色主题：干净、专业、信息密度高，但不能像网页白板一样漂浮。

设计目标：

- App 背景使用冷中性浅灰，作为最低层，不直接承载内容。
- Sidebar / Toolbar 比 App 背景略实，形成软件框架感。
- Panel / Workspace 使用接近白色但不是所有区域同白，靠 1px 边框和轻微阴影分层。
- Card / List Item 使用清晰边框或极轻阴影，避免和背景糊在一起。
- Input 背景比 Card 略低或略灰，让用户一眼识别可输入区域。
- Hover 使用中性色轻填充，Selected 使用 `primary` 的低透明背景加左侧/顶部/边框强调。
- Primary 使用克制的冷蓝或蓝紫，不大面积铺满界面。

建议角色关系：

```text
Background: 最浅冷灰
Shell / Sidebar: 比 Background 更实一点的浅灰
Surface / Panel: 接近白色
Card: 白色或比 Panel 轻微抬升
Input: 浅灰白，边框比 Card 更明确
Hover: neutral / 4% - 6%
Selected: primary / 8% - 12%
Active: primary / 14% - 18%
Border: neutral / 8% - 14%
Text Primary: neutral 900
Text Secondary: neutral 600 - 700
Text Muted: neutral 450 - 500
```

### Lyra Dark 设计方向

Lyra Dark 应该是开发者和 AI workbench 的主力主题：深色、安静、耐看，但必须有明确层级，不能所有区域都是相近的黑灰。

设计目标：

- App 背景最深，承担窗口底色。
- Shell / Sidebar 比 App 背景略亮，形成框架边界。
- Workspace / Panel 再略亮，承载主要内容。
- Card / Popover / Dialog 使用更高亮度或更强边框表达层级。
- 暗色模式少用阴影，主要靠 surface 亮度差、边框、overlay 和 selected 状态分层。
- 禁止纯白边框和高饱和大色块。
- Primary 在暗色里稍微提亮，但仍只用于主按钮、焦点、当前选中和链接。

建议角色关系：

```text
Background: neutral 950 附近
Shell / Sidebar: 比 Background 亮 1 级
Surface / Panel: 比 Shell 亮 1 级
Card: 比 Panel 亮 1 级，或使用更明确边框
Input: 比 Panel 更收一点，focus 时 ring 明确
Hover: white / 5% - 7%
Selected: primary / 14% - 20%
Active: primary / 22% - 28%
Border: white / 8% - 14%
Text Primary: white / 88% - 92%
Text Secondary: white / 60% - 70%
Text Muted: white / 40% - 48%
```

### Lyra System 设计方向

Lyra System 不应该拥有第三套颜色。它只做一件事：跟随 OS 解析到 `lyra-light` 或 `lyra-dark`。

System 模式规则：

- macOS / Windows / Linux 系统切换时同步更新。
- Renderer 只拿到最终 resolved theme：`lyra-light` 或 `lyra-dark`。
- 设置页显示用户选择是 `System`，但调试面板可以显示当前 resolved mode。
- 禁止出现 `lyra-system.scss` 这类第三套 token 文件。
- System 切换必须验证无闪屏、无中间态黑字黑底、无弹窗颜色残留。

### 主题验收标准

每个保留主题必须完成以下验收：

- 所有 shadcn/ui 基础组件在 default / hover / active / focus / disabled / loading 下可读。
- 表格、输入框、Tabs、Sidebar、Toolbar、Dialog、Dropdown、Toast、DataTable、Card 的层级清晰。
- AI 面板、终端、浏览器工作区、软件商店、设置页使用同一套 token，不允许保留 demo 风格。
- Primary 不能变成装饰色；状态色不能被拿去做普通强调。
- Light 和 Dark 都必须通过对比度检查，尤其是 muted text、placeholder、disabled、selected item、popover。
- 任意页面不允许直接写 hex / rgb / hsl / oklch 颜色值，必须走 token。

## 视觉气质重定位

Lyra 不应该继续像 VS Code 皮肤或传统 IDE。目标应该更接近 Cursor 那种现代桌面工具气质：稳、干净、低噪音、控件精致、交互明确、适合长时间工作。Cherry Studio 和 Zen 的现代系统材质感可以参考，但不能走向轻浮、玩具感或过度彩色。

新的视觉关键词：

```text
现代
稳重
系统感
半透明外壳
清晰内容面板
柔和层级
克制但不死沉
低彩度但不糊
AI-native workbench，而不是 VS Code clone
```

当前 Lyra 显得古老、死沉、偏方正，问题主要不在某一个按钮，而在整体视觉策略：

- 主窗口和 `body` 都是实体背景色，App Shell 缺少系统材质，天然像一整块实心灰色软件。
- 当前 `lyra-dark` 很接近 One Dark / VS Code 语义：深蓝灰、实体 panel、硬边界、弱透明度，容易带出 IDE 感。
- `lyra-light` 的背景、surface、editor 都是实体浅灰/白，缺少材质差异，轻但不够现代。
- 很多区域靠硬边框和矩形分栏表达结构，缺少柔和的 material layer。
- 圆角虽然有 token，但整体视觉仍偏小、偏硬，卡片和列表项没有形成现代桌面软件的柔软感。
- 侧栏、顶部工具栏、AI 面板、终端、浏览器区像不同模块拼在一起，没有统一的 shell material。
- Hover、active、selected、loading、toast 等反馈不够系统化，界面静态时显得沉。
- 图标、按钮、列表、面板密度偏 IDE 化，缺少 Cursor 那种清晰、克制、成熟的 row/list/control 语言。

### 现代感来自哪里

Cursor、Cherry Studio 和 Zen 看起来更现代，不是因为颜色更多，而是因为它们用了这些设计手段：

- 外壳区域更像系统窗口材质，而不是普通网页容器。
- 侧栏和工具栏可以透明或半透明，吃到底层系统毛玻璃/窗口材质。
- 主内容区仍然保持清晰，不把所有东西都做成玻璃。
- 组件多用轻边框、ghost hover、柔和 selected，而不是到处实体色块。
- 圆角更柔和，尤其是输入框、列表项、popover、卡片。
- 阴影弱但有层级，浮层比普通卡片更明显。
- 状态反馈完整，hover/press/focus/toast/micro motion 让界面有生命力。
- 中性色为主，少量 primary 和状态色让界面有焦点，而不是变成彩色主题。
- 列表默认安静，hover 才出现可操作感，不用大面积高饱和选中块。
- 当前选中项不一定在列表内强行高亮，尤其是 select/dropdown 中应优先保证 hover 浏览和当前值展示的清晰关系。
- 说明文字不应把一级列表撑乱；长说明进入二级 preview、tooltip、details 或 row description，而不是直接塞进主行。

### Cursor 风格落地规则

设置页第一轮迭代后，Lyra 的商业发布级设置界面以 Cursor 为主参考，形成以下规则：

- 整体色彩以中性灰阶为主，避免大面积蓝色 hover、蓝色 selected 或彩色装饰。
- Hover 使用同色系轻背景变化，不使用高饱和主色。
- Focus 使用克制 ring 或边框变化，不能让输入框突然变成强烈发光控件。
- 输入框、select、textarea 使用稳定高度、轻边框、同色 hover/focus 层级，placeholder 弱但可读。
- Boolean / on-off 选项使用 Switch，不再用两个并排选项伪装开关。
- 互斥枚举使用 Select 或 SegmentedControl，不能为了省事写成一排临时 button。
- Select 列表支持有 icon、无 icon、有二级说明三种形态。
- Select 的二级说明默认不挤在一级 item 内，优先在 hover/focus 时显示 preview。
- Select / Popover 首次打开不能先向右闪一下再跳到左侧，浮层方向必须在打开前或首帧稳定。
- 打开一个 Select 后点击另一个 Select，应该关闭当前并直接打开目标，不要求用户点击两次。
- 长文本必须 ellipsis 或进入二级说明，不能把右侧方向键、check、icon 挤歪。
- 列表项左右 padding、icon 区、文本区、右侧 affordance 必须稳定，不随文案长度漂移。
- AI 设置不允许卡片套卡片。需要用 section + row group + inline controls 表达层级。
- AI 分类在设置页中使用 Lyra Logo 作为 icon，标题使用 `Lyra Agents`，不再显得像外部 demo。

### 系统毛玻璃与材质策略

Lyra 需要引入 material layer，但要克制。目标是“系统感外壳”，不是整页玻璃拟态。

推荐结构：

```text
Window / App Shell: 可使用系统透明、vibrancy、mica、acrylic 或 CSS fallback
Sidebar / Titlebar / Toolbar: 半透明材质层
Main Workspace: 更稳定的实体 surface，保证内容可读
Panel / AI Panel / Dock: 介于 shell 和 workspace 之间，可轻微半透明
Popover / Command Menu / Toast: 可使用更强的 blur、shadow、border
Table / Editor / Terminal: 不使用强毛玻璃，优先保证信息密度和可读性
```

毛玻璃使用规则：

- 只在 App Shell、Sidebar、Toolbar、Floating Overlay、Command Menu、Toast 这类 chrome / overlay 区域使用。
- 不在表格、代码编辑器、终端、长文本阅读区大面积使用 blur。
- 透明层必须有背景兜底色，不能完全依赖系统毛玻璃。
- blur 必须配合 border 和 surface tint，否则会糊成一片。
- 透明度必须分 light/dark 单独设计，不能同一个 opacity 两边通用。
- 必须支持关闭透明效果或降级到 opaque material，保证性能和可访问性。
- Windows / Linux 不应该为了模拟 macOS 透明而牺牲文字对比度。

建议新增 material token：

```text
--material-shell-background
--material-sidebar-background
--material-toolbar-background
--material-panel-background
--material-popover-background
--material-overlay-background

--material-border
--material-border-strong
--material-highlight

--material-blur-sm
--material-blur-md
--material-blur-lg
--material-saturate
--material-opacity
```

这些 token 只描述材质，不替代颜色角色。颜色角色仍然是 Background / Surface / Panel / Card / Border / Text / Primary / Accent / State / Overlay。

### 平台策略

macOS：

- 主窗口优先支持透明窗口和系统 vibrancy。
- 侧栏、标题栏、工具栏可以 `background: transparent` 或 material token，让系统材质露出来。
- 内容区必须用稳定 surface 压住背景，避免文字被桌面背景干扰。

Windows：

- 优先研究系统 mica / acrylic 能力。
- 如果系统材质不可用，使用 token 化的 semi-transparent surface + blur fallback。
- 不能出现黑字黑底、白字白底、弹窗继承错误主题的问题。

Linux：

- 默认使用 opaque fallback。
- 可以保留轻透明 CSS material，但不依赖系统毛玻璃。
- 视觉目标仍保持一致：轻边框、柔和 hover、清晰层级。

### Lyra 的新界面气质

最终 Lyra 应该是：

- 侧栏像系统窗口的一部分，不像网页里的左侧 card。
- 顶部工具栏轻、透明、有 hover 状态，不像传统 IDE 菜单栏。
- 主工作区干净、清晰、可长时间阅读。
- AI 面板不再像嵌入 demo，而是和 shell、card、input、toast 使用同一套材质。
- 软件商店卡片更像现代应用市场，不像普通表格卡片。
- 设置页像成熟桌面软件设置，不像网页表单堆叠。
- 终端和代码区保持专业，不被过度装饰。

这次重构的核心不是“换一套颜色”，而是把 Lyra 从实体灰色 IDE 外观转成：

```text
系统材质外壳 + shadcn 组件体系 + 清晰工作区 + 统一 AI 产品语言
```

## 间距系统

全项目只使用固定 spacing scale：

```text
0 / 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64
```

常用规则：

- 紧凑控件内部 padding：`6 / 8`
- 普通控件内部 padding：`8 / 12`
- 卡片 padding：`12 / 16`
- 页面 section gap：`16 / 24`
- 大区域 padding：`24 / 32`
- 列表 item gap：`4 / 6 / 8`
- 工具栏按钮间距：`4 / 6`
- 表单字段间距：`8 / 12`

禁止随手新增：

```text
7px / 13px / 21px / 27px / 31px
```

如确实需要视觉校正，必须进入 token，并说明用途。

分组间距规则：

- 同组元素距离小。
- 不同组元素距离大。
- 标题与正文距离小于 section 与 section 的距离。
- 列表 item 内部距离小于列表 item 之间距离。
- 页面边缘 padding 不应该小于卡片内部 padding。
- 分栏 gap 必须大于卡片内部 gap。

这套规则来自视频里的核心观点：留白不是空出来的地方，而是用来表达关系和层级的工具。

## 排版系统

设计大部分时候就是文本。Lyra 必须建立稳定 typography scale。

统一字体：

```text
UI 主字体：Geist
中文字体：Noto Sans SC
代码字体：Geist Mono
```

建议 font token：

```text
--font-ui: "Geist", "Noto Sans SC", system-ui, sans-serif
--font-zh: "Noto Sans SC", "Geist", system-ui, sans-serif
--font-mono: "Geist Mono", "SFMono-Regular", "Cascadia Code", monospace
```

建议字号：

```text
caption: 11px
meta: 12px
body: 13px
body-lg: 14px
title-sm: 16px
title-md: 18px
title-lg: 20px
display-workbench: 24px
```

建议行高：

```text
caption: 16px
body: 20px
body-lg: 22px
title-sm: 24px
title-md: 26px
title-lg: 28px
display-workbench: 32px
```

规则：

- Workbench 页面不使用营销型超大标题。
- 标题、正文、说明、meta 必须有固定层级。
- 卡片标题不能大到像 hero。
- 表格、列表、设置项优先使用紧凑排版。
- 英文、中文、代码字体要分别稳定。
- 代码、路径、命令只使用 mono 字体。
- 不在业务页面局部引入新的字体。
- 业务界面默认使用 `--font-ui`。
- 中文密集区域可以显式使用 `--font-zh`。
- Terminal、代码块、路径、命令、diff、日志统一使用 `--font-mono`。

## 基础组件规范

所有页面必须优先使用统一基础组件，不直接手写裸控件。

组件体系采用三层：

```text
Radix / shadcn primitive
  -> Lyra App component wrapper
    -> Business surface composition
```

含义：

- primitive 层解决无障碍、键盘、弹层、受控状态、基础结构。
- App component 层解决 Lyra 的尺寸、圆角、密度、状态、图标、loading、error、focus、motion。
- business surface 层只负责业务组合和信息结构，不再重新定义按钮、输入框、选择器、卡片、列表的视觉语言。

判断是否走偏：

- 如果业务页面直接 import Radix 或 `renderer/ui/primitives`，就是走偏。
- 如果一个页面为了特殊视觉又写了一套 `.xxx-button`、`.xxx-select`、`.xxx-card`，就是走偏。
- 如果设置页、AI 面板、软件商店的同类控件 hover/focus/disabled 不一致，就是走偏。
- 如果为了模仿 Cursor 的某个细节，需要扩展 `AppSelect`、`AppInput`、`AppSettingsRow`，应该改 App 组件，而不是只在某个页面覆盖 CSS。
- 页面级 CSS 可以负责 grid、scroll、section spacing、surface hierarchy，但不负责重新发明通用控件。

目标组件：

```text
<Button />
<IconButton />
<Input />
<Textarea />
<Select />
<Checkbox />
<Switch />
<Tabs />
<Dialog />
<Popover />
<DropdownMenu />
<Tooltip />
<Toast />
<Card />
<Panel />
<Sidebar />
<Toolbar />
<CommandMenu />
<DataTable />
<List />
<EmptyState />
<LoadingState />
<ErrorState />
<Badge />
<StatusDot />
<SearchField />
```

组件必须统一：

- 圆角。
- 边框。
- 阴影。
- 高度。
- padding。
- 字号。
- icon 尺寸。
- hover 态。
- active 态。
- selected 态。
- focus-visible 态。
- disabled 态。
- loading 态。
- destructive 态。

组件表达规则：

- Button 表达动作。
- Tabs 表达同一层级内容切换。
- Sidebar 表达导航。
- Card 表达一个独立对象。
- Panel 表达一个功能区域。
- Dialog 表达阻塞式决策。
- Popover 表达非阻塞补充信息。
- Toast 表达操作结果。
- Tooltip 解释图标按钮或低频操作。
- Badge 表达状态或短标签，不承载长文本。

设置类组件补充规则：

- SettingsSection 表达一个设置分组。
- SettingsRow 表达一个具体设置项。
- SettingsRow 内左侧是 title / description，右侧是 control。
- SettingsRow 之间默认形成 row group，不把每个选项都做成独立卡片。
- 需要强调的账户、provider、profile、role model 可以使用 list item 或 object row，不默认再套 card。
- 有层级说明时，优先使用 row description、hover preview、popover details，而不是把长说明直接塞进一级列表项。

## 推荐组件尺寸

控件尺寸：

```text
xs: 24px
sm: 28px
md: 32px
lg: 36px
xl: 40px
```

Icon 尺寸：

```text
xs: 12px
sm: 14px
md: 16px
lg: 18px
xl: 20px
```

圆角：

```text
sm: 4px
md: 6px
lg: 8px
xl: 10px
panel: 12px
full: 999px
```

推荐默认：

- Button 默认高度：`32px`
- Toolbar button：`28px`
- Sidebar row：`28px`
- List row compact：`28px`
- List row default：`36px`
- Card radius：`8px`
- Dialog radius：`12px`
- Input height：`32px`

按钮 padding 指导：

- 纯图标按钮宽高相等。
- 带文字按钮宽度通常约为高度的 2 倍或以上。
- 图标加文字按钮使用固定 gap。
- 主按钮和次按钮并排时，主按钮更实，次按钮更轻。
- Ghost button 默认无背景，hover 时出现轻背景。

## 交互反馈规范

所有交互组件必须有反馈，不允许“点击了但看不出发生什么”。

基础反馈：

- Hover：告诉用户可操作。
- Pressed：告诉用户操作已触发。
- Focus-visible：告诉键盘用户当前位置。
- Loading：告诉用户操作处理中。
- Success：告诉用户操作完成。
- Error：告诉用户操作失败并给出恢复路径。

组件要求：

- Button 需要 default、hover、pressed、disabled、loading。
- Input 需要 default、focus、error、warning、disabled。
- Select 需要 closed、open、selected、disabled。
- Tabs 需要 inactive、hover、active、dragging。
- Card 需要 default、hover、selected、disabled。
- Menu item 需要 default、hover、active、disabled、danger。
- Toast 需要 info、success、warning、error。

微交互原则：

- 动画时间短。
- 动画用于解释状态变化。
- 动画不能成为主要视觉噪音。
- 复制、保存、发送、安装、删除等操作必须有确认反馈。
- 加载和错误必须有统一组件，不允许局部写临时文案。

## 固定应用结构

Lyra Desktop 应该有稳定的应用骨架，页面不能各自决定宽高、背景和主容器。

建议结构：

```tsx
<AppShell>
  <TitleBar />
  <MainLayout>
    <PrimarySidebar />
    <WorkspaceArea>
      <WorkspaceTabs />
      <WorkspaceToolbar />
      <WorkspaceSurface />
    </WorkspaceArea>
    <AiPanel />
  </MainLayout>
  <BottomDock />
  <GlobalOverlays />
</AppShell>
```

页面结构规则：

- Shell 负责窗口级布局。
- WorkspaceArea 负责主工作区。
- Surface 负责页面内容。
- Toolbar 只放当前页面操作。
- Sidebar 只放导航与上下文。
- Dialog、Popover、Toast 全部走统一 overlay system。
- 页面不能自己创建另一套顶栏、底栏、tab chrome。

## 样式目录建议

当前第一轮采用的桌面端样式结构：

```text
apps/desktop/src/renderer/styles/
  index.scss
  tailwind.css
  tokens.css
  base.css
  material.scss
  app-ui.scss
  shell.scss
  surfaces.scss
  agents.scss
  effects.scss
```

职责边界：

- `index.scss` 是唯一入口，负责导入顺序。
- `tokens.css` 定义 Lyra token、shadcn-compatible token、字体、主题变量。
- `tailwind.css` 负责 Tailwind v4 `@theme inline`，只映射 token，不直接定义页面视觉。
- `material.scss` 是唯一产品视觉颜色源，负责 `--lyra-app-*`、窗口材质、系统毛玻璃、opaque fallback、theme preview、effect/code/diff/skeleton token。
- `app-ui.scss` 负责通用 Lyra App 组件样式，例如 button、input、select、switch、card、settings row 的通用状态。
- `shell.scss` 承接 App Shell、titlebar、browser tabs、context menu、omnibox、panel/resizer 等外壳布局。
- `surfaces.scss` 承接 Settings、Software Store、File Manager、Notification Center、Login Manager、History、Browser/Search、File Editor、Image Viewer、Terminal 等业务 surface 布局。
- `agents.scss` 承接 AI Panel / Lyra Agents 和剩余 agent surfaces 布局。
- `effects.scss` 承接 animated magic border、shimmer、skeleton/pattern 等可复用效果。
- 旧 `renderer/styles/workbench/*.css` 聚合体系已物理删除，不再作为兼容层保留。
- 当设置页中的样式被第二个 surface 复用时，应上移到 App 组件或 `app-ui.scss`。
- 后续如果 token 拆分变大，可以再把 `tokens.css` 拆成 `tokens/colors.css`、`tokens/spacing.css`、`tokens/typography.css` 等，但不急于为拆分而拆分。

建议 UI 组件目录：

```text
apps/desktop/src/renderer/ui/
  primitives/
    button.tsx
    input.tsx
    textarea.tsx
    select.tsx
    checkbox.tsx
    switch.tsx
    tabs.tsx
    dialog.tsx
    popover.tsx
    dropdown-menu.tsx
    tooltip.tsx
    toast.tsx
  components/
    app-button.tsx
    app-input.tsx
    app-card.tsx
    app-tabs.tsx
    app-dialog.tsx
    app-sidebar.tsx
    app-toolbar.tsx
    app-data-table.tsx
    app-command-menu.tsx
  app/
    lyra-logo.tsx
    status-dot.tsx
    empty-state.tsx
    loading-state.tsx
    error-state.tsx
    notification-card.tsx
    software-card.tsx
  layout/
    app-shell.tsx
    workspace-layout.tsx
    sidebar-layout.tsx
    panel-layout.tsx
    split-pane.tsx
  tokens/
    theme.ts
    variants.ts
    motion.ts
  index.ts
```

Workbench 可以有自己的业务组合层，但不能成为全局组件系统的根目录：

```text
apps/desktop/src/modules/workbench/ui/
  components/
    workbench-shell.tsx
    browser-workspace.tsx
    ai-panel-shell.tsx
    terminal-dock-shell.tsx
    file-manager-panel.tsx
    software-store-view.tsx
```

目录边界规则：

- `renderer/ui/primitives/` 放 shadcn/ui 源码集成后的基础 primitive，允许保留 shadcn 的原始结构和 Radix 组合方式。
- `renderer/ui/components/` 放 Lyra App 级包装组件，统一 variant、size、icon、loading、disabled、focus、density、motion。
- `renderer/ui/app/` 放跨页面可复用的产品组件，例如通知卡片、软件商店卡片、空状态、状态点、Logo。
- `renderer/ui/layout/` 放全局布局骨架，不绑定 workbench 单一模块。
- `modules/workbench/ui/` 只放 workbench 专属组合，不放 Button/Input/Card/Tabs/Dialog 这类全局基础组件。
- 业务页面不要直接消费 shadcn 原组件，也不要直接消费 Radix primitive。
- 业务页面默认从 `renderer/ui/components` 或 `renderer/ui/app` 引入 Lyra App 组件。
- 只有 `renderer/ui/components` 可以包装和再导出 `renderer/ui/primitives`。
- 只有 `renderer/ui/primitives` 内部可以直接使用 Radix primitive。
- 如果未来 Lyra 增加非 workbench 模块，它们继续复用 `renderer/ui`，不反向依赖 workbench。

## 图标规范

统一使用 lucide-react。

规则：

- 所有普通功能图标来自 lucide-react。
- 所有 icon button 使用统一 `<IconButton />`。
- 图标尺寸默认 `16px`。
- toolbar 图标默认 `14px`。
- 状态图标按语义 token 着色。
- 不再手写 SVG 功能图标。
- 不再在不同页面混用不同线宽、填充风格、emoji 图标。
- Lyra logo 是唯一例外。

## AI 面板统一方案

AI 面板现在是独立 demo 嵌入，这是整体不统一的核心来源之一。

重构目标：

- 删除 AI demo 独立 token 体系。
- 删除 `--color-*`、`--space-*`、`--radius-*` 的独立设计语言。
- 保留业务能力和交互逻辑。
- 视觉全部改用 workbench 组件。
- Message、Composer、ToolCard、PermissionPanel、DecisionPanel、SessionTabs 都要组件化。

AI 面板目标结构：

```text
AiPanel
  AiSessionTabs
  AiThread
    MessageList
    MessageBubble
    ToolCallCard
    PermissionCard
    DecisionCard
  AiComposer
    AttachmentBar
    ModelSelect
    PermissionModeSelect
    SendButton
```

AI 面板必须与主应用统一：

- 同一字体。
- 同一输入框。
- 同一按钮。
- 同一卡片。
- 同一 tab。
- 同一 dropdown。
- 同一 loading state。
- 同一 empty/error state。

AI 设置补充要求：

- 设置页中的 AI 分类命名为 `Lyra Agents`。
- 设置页中的 AI 分类使用 Lyra Logo 作为 icon，颜色、尺寸、对齐必须匹配其他导航 icon。
- Provider、Account、Profile、Role Model、Notification 等设置不再保留 demo 感。
- AI 设置不允许卡片套卡片，优先使用 section + row group + object row。
- Agent 设置、模型选择、provider 登录都要使用统一 Settings/List/Form 组件。
- 任何 AI 专属 icon 必须纳入统一 icon 语言；不能继续使用风格不一致的 demo icon。

## 设置页样板结论

设置页是第一轮 UI/UX 重构的样板 surface。后续页面迁移时，不以旧页面为视觉基线，而以设置页沉淀出的 Cursor-like 组件语言为基线。

设置页保留的方向：

- 左侧导航固定宽度，图标、文字、hover、active 统一。
- 主内容区使用稳定最大宽度和滚动区域，避免表单横向铺满导致发散。
- 设置项采用 section + row group，而不是大量独立 card。
- Boolean 设置使用 Switch。
- 枚举设置使用 Select。
- 长说明不挤压一级列表。
- 输入框、搜索框、textarea 使用统一 AppInput/AppTextarea。
- Provider、Account、Profile、Role Model 使用同一套 object row/list 语言。
- AI 设置不再表现为嵌入 demo，而是 `Lyra Agents` 设置模块。
- 选中、hover、focus、disabled、loading 都用中性、克制、可读的状态表达。

设置页中禁止回退的旧模式：

- 卡片套卡片。
- 蓝色 hover 到处出现。
- 竖线加文字作为主要导航选中样式。
- 开关类设置用两个文字选项代替 Switch。
- 每个设置分组自己定义 padding、border、radius。
- Select 一级 item 直接塞长说明导致图标和方向键错位。
- Popover 第一次打开时先越界再跳回。
- AI 模块继续保留独立 demo 视觉。

## 重点改造界面

第一优先级：

- Settings。已经作为第一轮样板，继续作为组件语言校准基线。
- App Shell。
- 顶部工具栏。
- Workspace Tabs。
- AI Panel。
- Browser/Search Surface。

第二优先级：

- File Manager。
- File Editor。
- Terminal Dock。
- Notification Center。
- Software Store。
- Login Manager。
- Agent Session History。

第三优先级：

- Image Viewer。
- Agent Git。
- Agent Project Tree。
- Agent Self Dev。
- Agent Overnight。

## 迁移阶段

### Phase 0: Baseline Audit

产出：

- 当前主界面截图。
- 当前设置页截图。
- 当前 AI 面板截图。
- 当前文件管理器截图。
- 当前通知中心截图。
- 当前软件商店截图。
- 当前 terminal 截图。

目的：

- 明确哪些界面必须被统一。
- 建立重构前后对比基线。

### Phase 1: Stack Foundation

引入：

- Tailwind CSS。
- SCSS 编译链。
- shadcn/ui 源码组件。
- Radix UI primitives。
- class-variance-authority。
- tailwind-merge。
- clsx。

产出：

- Tailwind config。
- SCSS entry。
- token bridge。
- `cn()` 工具。
- `renderer/ui/primitives` shadcn-compatible component structure。
- `renderer/ui/components` Lyra App component wrapper structure。

### Phase 2: Design Token System

产出：

- color token。
- spacing token。
- radius token。
- typography token。
- shadow token。
- z-index token。
- motion token。
- light/dark theme。

要求：

- 旧 `--lyra-*` token 与新 token 需要有明确映射。
- 新代码只使用新 token。
- 旧 token 仅作为过渡 compatibility layer。

### Phase 3: Unified Components

先落地基础组件：

- Button。
- IconButton。
- Input。
- Textarea。
- Select。
- Tabs。
- Card。
- Dialog。
- DropdownMenu。
- Tooltip。
- Toast。
- Sidebar。
- Toolbar。
- DataTable。
- EmptyState。
- LoadingState。
- ErrorState。

要求：

- 每个组件有 variants。
- 每个组件有 size。
- 每个组件覆盖 hover、focus、active、disabled。
- 每个组件支持 dark mode。
- 每个组件有最小测试或 Story/fixture。
- SettingsRow、SettingsSection、AppSelect、AppSwitch、AppInput 必须先达到设置页发布级质量，再推广到其他 surface。
- Cursor-like list/select/input 细节优先沉淀到 App 组件层。

### Phase 4: Settings Surface Calibration

设置页作为第一轮定版样板：

- 用 `renderer/ui/components` 重写设置页内部控件。
- 用 `surfaces.scss` 只承载设置页布局、section、row group、AI 设置组合样式。
- 通用按钮、输入框、select、switch、card、row 状态必须回流到 App 组件和 `app-ui.scss`。
- 校准 light/dark/system、opaque/material fallback、小窗口、长文本、密集 AI 设置。
- 通过设置页验证 Cursor-like 密度、灰阶、hover、focus、popover、switch、select 行为。

这一步完成后，设置页不再只是“样板”，而是后续迁移的视觉和交互基准。

### Phase 5: App Shell Rewrite

重构：

- TitleBar。
- WorkspaceArea。
- Sidebar。
- WorkspaceTabs。
- BottomDock。
- GlobalOverlays。

目标：

- 先统一外壳，再统一页面。
- 消除多套 tab chrome 堆叠。
- 明确主工作区与 AI 面板关系。
- 统一窗口按钮、工具按钮、tab、地址栏、状态栏。

### Phase 6: Surface Rewrite

按 surface 迁移：

1. AI Panel。
2. Search / Browser Surface。
3. Software Store。
4. Notification Center。
5. File Manager。
6. Terminal。
7. Remaining agent surfaces。

每个 surface 迁移标准：

- 不再直接写裸 button/input/select。
- 不再自定义局部 tab/card/list/button 样式。
- 不再引入独立 token。
- 不再定义局部颜色系统。
- 所有状态走统一组件。
- 迁移时可以调整 JSX 结构和 class 结构，不要求视觉零回归。
- 迁移结果必须比旧界面更统一、更像同一个产品，否则不算完成。

### Phase 7: Remove Legacy CSS

删除或归档：

- 旧 `renderer/styles/workbench/*.css` 聚合目录已物理删除；后续不得恢复。
- AI demo 独立 CSS。
- 自写 chrome primitives。
- 重复 icon registry。
- 未使用 prototype 组件。

删除前要求：

- 对应界面已经迁移。
- 测试通过。
- 截图对比通过。

### Phase 8: UI Guard Upgrade

升级 UI 守卫：

- 禁止新业务代码直接使用 `<button>`，除非在基础组件内部。
- 禁止新业务代码直接使用 `<input>`，除非在基础组件内部。
- 禁止模块 CSS 新增颜色字面量。
- 禁止模块 CSS 新增非 token 间距。
- 禁止非 lucide 图标。
- 禁止 surface 自建 tabs/card/button/list 样式。
- 检查 shadcn component usage：业务页面禁止直接 import `renderer/ui/primitives` 或 Radix primitive。
- 检查 Lyra App component usage：业务页面默认只能 import `renderer/ui/components`、`renderer/ui/app`、`renderer/ui/layout`。

## 验收标准

视觉验收：

- 所有主界面看起来属于同一个软件。
- 用户能一眼区分 shell、sidebar、workspace、panel、card、input。
- AI 面板不再像外部 demo。
- 设置页、软件商店、通知中心、文件管理器使用同一套组件语言。
- hover、selected、active、disabled 状态一致。
- 深色模式不糊成一片。
- 浅色模式不灰成一片。
- 整体气质接近 Cursor 式现代桌面工具：克制、稳重、低噪音、有密度。
- 不出现大面积蓝色 hover、玩具感主色、临时 demo 卡片、网页表单堆叠。
- 列表项、select item、settings row 的 icon 区、文本区、右侧 affordance 对齐稳定。
- 输入框、搜索框、textarea、select trigger 在 light/dark 下都有成熟的 hover/focus/disabled 状态。

工程验收：

- `npm run lint:ui-style` 通过。
- Desktop typecheck 通过。
- 关键 workbench tests 通过。
- 新组件有基本测试或 fixture。
- 旧 CSS 删除有明确 PR/commit。
- 新增样式不依赖随机裸值。
- 业务页面不直接 import Radix 或 `renderer/ui/primitives`。
- 通用控件状态不散落在页面 CSS 中。

可用性验收：

- 启动后不出现空白主界面。
- Electron bridge 缺失时有错误边界或降级提示。
- 空状态、加载状态、错误状态统一。
- 键盘 focus-visible 清晰。
- 弹窗、菜单、select、tooltip 层级正确。
- 小窗口下不重叠、不截断、不挤爆。
- Select/Popover 第一次打开方向稳定，不先越界再跳回。
- 点击另一个可展开控件时，当前浮层关闭并直接打开目标控件。
- 长文案不会挤歪 check、arrow、icon 或导致控件高度异常跳变。

## 不做的事

本次 UI/UX 重构不应该顺手做：

- Agent 业务逻辑重写。
- Runtime 架构重写。
- 文件系统能力重写。
- 浏览器内核能力重写。
- 大规模数据模型改造。
- 与 UI 无关的性能优化。

这些可以后续独立规划，避免 UI 重构变成不可回退的大泥球。

## 推荐提交边界

建议提交粒度：

```text
chore(ui): add tailwind and scss foundation
feat(ui): add design tokens and theme bridge
feat(ui): add unified shadcn component layer
refactor(shell): rewrite app shell layout
refactor(ai): migrate ai panel to unified components
refactor(settings): migrate settings surface
refactor(files): migrate file manager surface
refactor(store): migrate software store surface
chore(ui): remove legacy workbench css
test(ui): add visual and style guard coverage
```

## 最终判断标准

这次重构成功的标准不是“看起来更好看一点”，而是：

所有页面都像从同一个设计系统里长出来的。

用户看到任何按钮、输入框、tab、卡片、列表、弹窗、通知、设置项，都能立刻感觉它们属于 Lyra，而不是分别属于不同 demo、网页或临时工具。
