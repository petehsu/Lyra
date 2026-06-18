# Lyra Desktop Computer Use 架构方案

> 状态：讨论稿（2026-06）  
> 目标：在 Lyra 内建立**多平台、可后台、以语义操控为主**的 Computer Use 能力——像浏览器 DOM 操作一样操控整台电脑，而不是「看截图然后点坐标」。

---

## 0. 两条主线（不可妥协）

### 主线 1：不要把 Computer Use 等同于「看截图然后点坐标」

业界很多「Computer Use」demo 本质是：**截图 → 模型猜坐标 → 模拟点击**。这对 Lyra 不合适：

- Token 贵、延迟高、每一步都要 vision  
- 多显示器 / DPI / 主题变化下坐标极易失效  
- 无法审计「点的是什么」  
- 很难后台化  

Lyra 的选择：**语义树 + handle 操作**，视觉只在语义路径失败时兜底。

### 主线 2：后台操作必须走语义 API，而不是模拟鼠标键盘

真正「不抢鼠标、不抢焦点」的能力，**只能**来自：

- Accessibility / UI Automation / AT-SPI 等**语义 API**  
- App 自有 automation API（AppleScript、Shortcuts、COM、内部 IPC）  
- Lyra 自研 surface 的 **runtime IPC**（browser、terminal、file manager…）

**模拟全局鼠标键盘几乎不可能优雅后台化**——它天然操作的是当前用户会话的前台。因此：

| 路径 | 能否后台 | Lyra 态度 |
|------|----------|-----------|
| `AXPress` / `InvokePattern` / `setText` on node | 常能 | ✅ 主路径 |
| AppleScript / PowerShell / Shortcuts | 部分能 | ✅ 结构化兜底 |
| Lyra 内部 IPC（browser、terminal…） | 能 | ✅ 最稳 |
| 全局 `CGEvent` / `SendInput` / xdotool 点坐标 | 不能（抢前台） | ⚠️ 仅 shared 模式、非后台 |
| 截图 + vision + 坐标 | 不能 | ⚠️ Level 3 fallback only |

### 0.3 核心判断：三件事是同一机制的产物

用户常把 **多平台**、**后台操作**、**非视觉** 当成三个独立特性分别实现，结果互相打架。实际上它们应是**同一机制的不同侧面**：

> **只要动作下发走「语义动作」而不是「坐标合成输入」，非视觉和后台是免费送的。**

语义动作（点这个按钮、把输入框设成 X、勾这个框）直接作用在元素上：

| 属性 | 语义动作 | 坐标合成输入（CGEvent / SendInput / XTest） |
|------|----------|---------------------------------------------|
| 是否需要坐标 | ❌ 不需要 → **天然非视觉** | ✅ 必须有 → 依赖视觉 |
| 是否抢前台焦点 | ❌ 通常不需要 → **天然后台** | ✅ 必须抢 → **不能真后台** |
| 跨平台抽象 | ✅ 三平台同构 API → **天然可抽象** | ⚠️ 各写一套、行为不一致 |

因此不是「A 方案 vs B 方案」，而是 **A 为主干、B 仅在某元素没有语义动作时兜底**。  
Lyra 浏览器侧的 `agent-observation-engine` + `axRef` + `actionCapabilities` 本质上已是这套哲学——**只是把 DOM 层抬升到 OS 层**。

**Lyra 立场（产品定调）**：**非视觉优先 + 视觉托底**（见 §12.1），不是「纯盲飞」。

---

## 1. 背景与问题

Lyra Workbench 浏览器已具备成熟链路：

```text
DOM 语义树 (map / locate / find + targetRef)
  → browser_ax (axRef)
    → see / vact（视觉兜底）
```

当前缺口：

| 能力 | 浏览器（Lyra 内） | 整台电脑（原生 App） |
|------|-------------------|----------------------|
| 语义 map / query / act | ✅ DOM + browser_ax | ⚠️ macOS OS AX 雏形，未产品化 |
| 统一 Computer Tree | ✅（页面内） | ❌ 无跨 app 树 |
| 后台 / 隔离会话 | ✅ live / isolated | ❌ 无统一模型 |
| 跨平台 | ✅ Electron 统一 | ❌ Win / Linux 未覆盖 |
| Tool-FS 集成 | ✅ `/tools/browser/*` | ❌ 无 `computer.*` / `desktop_ax` |
| 外部软件 | ⚠️ page-cite 已有 | ❌ 操控层缺失 |

**目标**：Agent 看到的是一套**统一电脑对象模型**，而不是一堆平台细节。

---

## 2. Computer Semantic Runtime（核心架构）

理想形态：像「浏览器 DOM 操作」一样，在 Agent 与 OS 之间加一层 **Computer Semantic Runtime**：

```text
Agent
  → Tool-FS / runtime policy
  → Computer Runtime                    # 统一语义层：树、快照、handle、observation diff
  → platform adapters                   # 跨平台归一化
       macOS   Accessibility / AppleScript / Shortcuts / native APIs
       Windows UI Automation / PowerShell / COM / Win32
       Linux  AT-SPI / D-Bus / xdotool fallback (X11)
  → app-specific adapters               # 已知 app 的强化路径
       browser, terminal, file manager, editor, settings, mail, …
  → Lyra internal surfaces (Level 1)  # 完全绕开 OS AX，走 IPC
```

### 2.1 与现有 Lyra 模块的收束

| 已有模块 | 收束方向 |
|----------|----------|
| `lyra-accessibility-napi` | macOS platform adapter 底层 |
| `ax-controller.ts` / `browser_ax` | 浏览器侧语义树；模式复用到 desktop |
| Workbench observation | 扩展为 Computer observation / diff |
| Tool-FS + permission policy | `computer.*` 工具注册与门控 |
| `prompt_policy` browser 策略 | 泛化为 host surface / computer 策略 |
| Plugin SDK `ai-computer` surface | 挂载 app-specific adapter |

---

## 3. Computer Tree：统一对象模型

核心不是截图，而是维护一棵跨平台的 **Computer Tree**（类比 DOM + accessibility tree 的合体）：

```typescript
type ComputerNode = {
  id: string;              // 稳定 handle：computer node id（非坐标）
  platform: "darwin" | "win32" | "linux";
  app: string;             // bundleId / exe / 逻辑名
  window?: string;         // 窗口标题或 window handle
  role: string;            // button, textField, menuItem, table, document, tab, …
  label: string;           // 可访问名称
  value?: string;          // 当前值（输入框、选中项）
  bounds?: { x: number; y: number; width: number; height: number };
  state: {
    focused?: boolean;
    enabled?: boolean;
    selected?: boolean;
    checked?: boolean;
    expanded?: boolean;
  };
  actions: ComputerAction[];  // 此节点支持的语义动作
  relationships?: {
    parentId?: string;
    children?: string[];
  };
  source: "internal-ipc" | "os-ax" | "app-adapter" | "vision-inferred";
  snapshotId: string;
};

type ComputerAction =
  | "press"
  | "setText"
  | "select"
  | "focus"
  | "scroll"
  | "open"
  | "reveal"
  | "toggle";
```

### 3.1 模型怎么操作（心智模型）

不说「点 (320, 480)」，而说：

```text
computer.find({ app: "Finder", role: "button", label: "New Folder" })
computer.run({ nodeId: "cn-abc123", action: "press" })
```

等价于浏览器里的：

```text
browser.map → browser.find → browser.act({ targetRef })
```

**坐标可以存在**（Level 3），但不得作为**主协议**；且每次坐标 act 前后必须有 observation diff 验证。

### 3.2 Tool-FS 映射（`computer.*`）

对外暴露为 Tool-FS 工具族（与内部 runtime API 一一对应）：

| 语义 API | Tool 路径（建议） | 说明 |
|----------|-------------------|------|
| `computer.listApps` | `/tools/computer/list_apps` | 当前运行的 app / 前台窗口 |
| `computer.map` | `/tools/computer/map` | 建立 Computer Tree 快照 |
| `computer.find` | `/tools/computer/find` | 按 app / role / label 查询 nodeId |
| `computer.run` | `/tools/computer/run` | 对 nodeId 执行语义 action |
| `computer.focus` | `/tools/computer/focus` | 切换 app / 窗口 |
| `computer.observe` | `/tools/computer/observe` | 读取焦点控件 / 前台状态 |
| `computer.explain` | `/tools/computer/explain` | 失败归因：走 adapter / 脚本 / 视觉？ |
| `computer.diff` | `/tools/computer/diff` | 两次 snapshot 间 observation diff |

> 注：`/tools/desktop_ax/*` 可作为 `computer.*` 的 macOS/Win/Linux AX 实现细节层；Agent prompt 面向 `computer.*`，adapter 对内分流。

---

## 4. 三级能力（Capability Levels）

### Level 1：内部 Surface 操作（最稳、最像后台）

Lyra **自己掌控**的表面，直接走现有 IPC / runtime，**完全绕开视觉与 OS AX**：

| Surface | 现有能力 | 统一 action model |
|---------|----------|-------------------|
| Lyra 浏览器 | `/tools/browser/*`, `browser_ax` | map / find / act |
| 终端 | `/tools/shell/*`, terminal dock | run command / read pane |
| 文件管理器 | file manager IPC | reveal / open / select |
| 编辑器 | file editor runtime | open / goto / edit |
| 设置 | settings surface | read / set |
| 下载器 | download manager | list / import / open |

**原则**：能走 Level 1 绝不升到 Level 2。

### Level 2：OS Accessibility 语义操作

控制**其他桌面 app**：读窗口树、按按钮、填输入框、选菜单、读表格/列表。

跨平台 **normalized adapter**（同 `ComputerNode` schema，不同底层）：

| 平台 | 主 API | 后台语义能力 | 备注 |
|------|--------|--------------|------|
| macOS | Accessibility (`AXPress`, `AXSetValue`…) | 部分控件可不动焦点；部分仍要求 activate | `lyra-accessibility-napi` 已有基础 |
| macOS 补充 | AppleScript / Shortcuts | 部分 app 可脚本后台 | 作 app-adapter |
| Windows | UI Automation (`InvokePattern`, `ValuePattern`…) | **很适合**后台语义 invoke | 待建 adapter |
| Windows 补充 | PowerShell / COM | 结构化兜底 | |
| Linux | AT-SPI / D-Bus | 一部分可后台 | Wayland 麻烦，X11 更自由 |
| Linux 补充 | xdotool / ydotool | 仅 X11；**前台**，非后台 | Level 2 末位兜底 |

### Level 3：视觉 + 输入兜底

- 截图、OCR、元素定位、坐标点击、键盘输入  
- **仅**当：语义节点找不到、控件无 accessibility 信息、或需理解图像内容  
- 必须：`explain` 标记 `fallback: "vision"` + `risk: "coordinate"` + 绑定 `captureId`  
- 执行前后 **observation diff** 确认状态变化  

---

## 5. Host Surface 与 Session 模式

Computer Tree 之上的会话抽象（与 browser `live` / `isolated` 对齐）：

```typescript
type HostSurface = {
  surfaceId: string;
  surfaceKind: "browser" | "terminal" | "desktop-app" | "external-url" | "internal-lyra";
  capabilityLevel: 1 | 2 | 3;
  mode: "shared" | "background-semantic" | "isolated-session";
  platform: "darwin" | "win32" | "linux";
  targetLabel: string;
  targetRef?: string;       // bundleId / pid / tabId / url
  snapshotId?: string;
  permissionState: "granted" | "pending" | "denied";
};
```

| mode | 含义 | 允许的能力层 |
|------|------|--------------|
| `shared` | 用户可见，可抢回（Follow） | L1 / L2 / L3（L3 慎用） |
| `background-semantic` | 不抢焦点，语义 API | L1 / L2 only |
| `isolated-session` | 独立桌面空间 / 隐藏实例 | L1 / L2，长任务推荐 |

---

## 6. 三个真正的难点（决定成败）

浏览器侧许多能力在 OS 侧**不再免费**，必须预先设计：

### 6.1 引用稳定性（`osRef`）——最硬的地基

| 平台 | 原生句柄 | 稳定性 |
|------|----------|--------|
| 浏览器 DOM | `nodeId` + snapshot 哈希 | 高 |
| macOS | `AXUIElementRef` 活句柄 | 会失效 |
| macOS 现方案 | `os_path`（role + index 路径） | 方向正确 |
| Windows | `RuntimeId` | 半稳定 |

**统一契约**：`osRef` 是**不透明 token**，由各 backend 负责重新解析（re-resolve），不是可随意 deref 的指针。  
Agent 只拿 `osRef`；backend 拿 `osRef` 在当前树里重新定位元素。**此契约必须先设计死。**

### 6.2 树的规模与噪声

OS AX 树比 DOM 大一个量级且脏（无名容器、重复分组）。必须复用浏览器侧思路：

- **strategy 过滤**：`interactive` / `document`（对齐 `browser_ax` strategy）  
- **范围缩小**：frontmost app / 指定 window / pid  
- **maxNodes 截断** + role → `actionCapabilities` 剪枝  

### 6.3 动作的闭环验证（非视觉的命门）

有视觉时，模型能看见点完界面变了。纯语义时，点完无反馈 = **盲飞**。

**因此 `act` 之后必须自动**：

1. 重扫该元素局部子树（或 window 级浅层 rescan）  
2. 回传 **diff**（例：`checkbox state: unchecked → checked`）  
3. 失败则 `explain` 建议升级路径  

这是非视觉方案能否可用的**分水岭**；浏览器侧靠 `map` / `see` 回读，桌面侧靠 `computer.diff` 强制闭环。

---

## 7. 设计原则（汇总）

1. **语义动作为主协议** — 多平台 / 后台 / 非视觉是同机制的三面  
2. **`osRef` 不透明 + re-resolve** — 不是裸指针  
3. **Map → Find → Act 循环** — 与 browser 同构  
4. **Act 后必 diff** — 闭环验证，拒绝盲飞  
5. **视觉最后** — `computer.see` 可选，须 `explain` 升级  
6. **坐标兜底显式隔离** — 标注抢焦点，不污染主路径  
7. **内部 surface 优先** — Level 1 → 2 → 3  

---

## 8. 第一阶段场景（不追求通杀）

`computer.*` 第一版**不强求控制所有软件**，先打通：

- [x] 读取当前打开的 app / window / focused control（`computer.list_apps` / `computer.observe`；Level-1 合并 Lyra tabs）
- [ ] 查询窗口语义树（`map` + `find`）  
- [ ] 对节点执行 `press / setText / select / focus / scroll`  
- [x] 打开 / 切换 app（`computer.focus`；shared 模式；Level-1 `lytab:` 路由）
- [ ] 菜单栏操作（macOS menu bar AX；Win 菜单 UIA）  
- [ ] 文件选择器（open panel）基本路径  
- [ ] 系统设置页（可读、可点常见 toggle）  
- [ ] **Lyra 自有** browser / terminal / file manager 与 `computer.*` **同一 action model**  

### 8.1 app-specific adapters（渐进）

对高频 app 可加专用 adapter（仍输出 `ComputerNode`）：

| App 类 | 策略 |
|--------|------|
| 浏览器（外部） | 优先「在 Lyra 内开 tab」→ Level 1；native 控制走 Level 2 |
| 邮件 / 日历 | AX + 脚本 |
| IDE | 优先 LSP / CLI；GUI 走 AX |
| 文件选择器 | 各平台 open panel 专用逻辑 |

---

## 9. 与外部浏览器 / page-cite

已实现：外部拖放 → `page-cite`（`sourceKind: external-browser`）。

操控层挂接：

```typescript
AgentPageCitation {
  sourceKind: "external-browser";
  pageUrl: string;
  openStrategy?: "fetch-only" | "open-in-lyra" | "control-external-app";
}
```

推荐默认：`open-in-lyra`（Level 1），仅在用户明确要求时 `control-external-app`（Level 2）。

---

## 10. Agent 策略（prompt_policy）

新增 `computer_use_section()` / `host_surface_section()`：

- Computer Use ≠ 截图点坐标  
- 后台禁止全局鼠标键盘；用 `computer.run` 语义动作  
- Level 1 优先：Lyra browser / terminal / files  
- `external-page-*` 禁止 `read_tab`；用 URL 或 `open-in-lyra`  
- 坐标 fallback 必须带 `captureId` + `computer.diff` 验证  
- CLI 能解决的走 `shell`，GUI 走 `computer.*`  

---

## 11. 安全与权限

- macOS：辅助功能；Windows：UIA；Linux：AT-SPI  
- 首次 `computer.map` 走权限面板  
- 白名单 vs 开放 AX（待决）  
- 硬禁止：密码框、银行敏感输入、未授权 app  
- `computer.explain` 返回 `blocked: true` + 原因  

---

## 12. 推荐下注（风险 / 产出最优）

| 决策 | 推荐 | 理由 |
|------|------|------|
| 架构 | 先立 `lyra-computer-use-core` trait，v1 仅 macOS backend | 不返工；napi 已有 ~512 行 |
| 平台顺序 | **macOS 做深 → Windows UIA → Linux 最后** | mac 有 FFI 起步，最快验证抽象；Win API 更规整但可第二批；Linux ROI 低 |
| 后台边界 | 语义动作优先；坐标合成仅显式兜底，工具描述写明「抢焦点」 | 不让兜底污染主路径 |
| 工具形态 | `/tools/computer/map` + `act` + 可选 `see` | 照抄 browser；Agent 默认不见坐标 |
| 视觉策略 | **非视觉优先 + 可选截图托底** | OS app 比网页脏，纯盲飞复杂原生 UI 会翻车 |

---

## 13. 落地路线图

| 阶段 | 内容 | 依赖 | 状态 |
|------|------|------|------|
| **D0** | `ComputerNode` + `osRef` 契约 + `lyra-computer-use-core` trait | — | ✅ 已完成 |
| **D1** | macOS backend（收编 `lyra-accessibility-napi`）+ `/tools/computer/map|act|diff` | D0 | ✅ 已完成 |
| **D1b** | Lyra 内部 surface 统一 action model | D0 | ✅ 已完成（computer.* 路由到 browser_ax / terminal / file-manager；10 测通过） |
| **D2** | `ComputerSnapshotStore` + act 后闭环 diff | D1 | ✅ 已完成 |
| **D3** | `background-semantic` / `isolated-session` + 权限 UI | D2 | 🟡 部分完成（强制内核已就位；渲染端权限面板/白名单待决） |
| **D4** | Windows UIA backend（trait 已验证后） | D0 | 🟡 代码完成（跨平台编译通过；真机运行待验证） |
| **D5** | 可选 `computer.see` + Level 3 兜底 + `explain` | D2 | 🟡 已完成视觉观测（computer.see + explain 升级）；坐标点击输入按 §14.2 留作后续 |
| **D6** | app-specific adapters | D2 | ⬜ 未开始 |
| **D7** | Linux AT-SPI（可选，低优先级） | D4 | 🟡 代码完成（feature 门控，跨平台编译通过；真机运行待验证） |

### D1 检查项

- [x] `lyra-computer-use-core`：`ComputerBackend` trait + `osRef` re-resolve（`osax:<role-index-path>`，动作时从焦点窗口重解析）  
- [x] macOS backend 收编 `lyra-accessibility-napi`（AX FFI 上移到 core，napi 退为薄 shim；新增 setText/state 读取）  
- [~] `ComputerNode` 类型：定义在 Rust core（`model.rs`），桌面 host 作为薄 marshaller 透传原生 JSON，未在 TS `shared/` 重复声明。若后续需要渲染端强类型再补 `shared/computer-use.ts`  
- [x] Tool-FS：`/tools/computer/map|act|find|diff|explain`  
- [x] host 层：`apps/desktop/src/main/agent/computer-tool-host.ts`（类比 `ax-tool-host.ts`）  
- [x] strategy 过滤（interactive/document）+ maxNodes（复用 browser_ax 思路）  
- [x] act 后自动 diff（`computer.act` 回传 before/after + changed；changed 为空回 warning）  
- [ ] 测试：Finder、Safari、系统设置（需手动授予辅助功能权限后在真实 app 验证）  

### D2 检查项

- [x] `ComputerSnapshotStore`：Rust core 进程级、TTL 60s、上限 16 份快照（`snapshot_store.rs`）  
- [x] `computer.map`/`computer.find` 返回 `snapshotId` 并记忆快照  
- [x] `computer.diff` 双模：单节点重读（`osRef`）/ 两快照 observation diff（`baselineSnapshotId` → added/removed/changed）  
- [x] catalog schema、工具描述、`computer_use_section` prompt 同步说明 `baselineSnapshotId`  
- [x] 单测：observation diff（增删改）+ 快照存取；core 6 测全过  

### D3 检查项

> 定位:把 §5 会话模式与 §11 安全约束做成**内核强制**(在 Rust core 里,Agent 绕不过),而不是先做渲染端 UI。§11 的「白名单 vs 开放 AX」仍待决,故未建权限面板。

- [x] `SessionMode`(shared / background-semantic / isolated-session),`model.rs`  
- [x] **真后台强制**:background/isolated 模式拒绝 focus/raise(`foregroundStealBlocked`),仅放行语义动作(§14.2)  
- [x] **密码框硬禁止**:`AXSecureTextField` → `securetextbox`,标 `secure: true`,不读 value、不暴露为 name;`computer.act` 拒绝 Agent 明文 `setText`(`secureFieldBlocked` / `blocked: true`)(§11)  
- [x] **凭证引用代填**:`computer.act` 接受 `sensitiveValueRef`(复用现成 `resolveSensitiveValueForFill`,与 lumen 浏览器代填同一解析器);host 在 main 进程解出明文 → native 带 `credentialFill: true`;core 仅在该标志下放行 secure 字段 `setText`。明文全程不进 Agent 上下文。底层加密箱(`safeStorage` + login-manager)已存在,本步是接线  
- [x] `computer.explain` 对 secure 节点返回 `blocked: true` + 原因 + `recommendation: user-action`  
- [x] `computer.act` schema/host/prompt 暴露 `mode`;host 校验枚举后透传  
- [x] 单测:background 模式 focus 被拒、shared 模式不触发该 gate;core 8 测全过  
- [ ] 渲染端权限面板(首次 `computer.map` 授权弹窗)— 待 §11「白名单 vs 开放 AX」定调后再做  
- [ ] `isolated-session` 的真正独立桌面空间/隐藏实例 — 目前与 background-semantic 同等对待(均真后台、语义 only),独立空间是后续增强  

### D4 检查项

> 关键意义:这是对「跨平台 trait 是否成立」的验证。macOS 的 `ComputerBackend` 抽象**未经任何改动**就容纳了 Windows UIA——同一套 `ComputerNode`/`osRef`/语义动作/secure 检测,只是后端不同。这印证了文档 §0.3 的核心判断。

- [x] `windows.rs`:`WindowsBackend` 实现 `ComputerBackend`,UIA COM 客户端(`CUIAutomation` → `IUIAutomation`)  
- [x] `osRef` 方案 `uia:<child-index-path>`,经 `RawViewWalker` 的 first-child/next-sibling 从焦点元素根重走——与 macOS `osax:` 同构,opaque token + 具体路径  
- [x] 语义动作:`InvokePattern.Invoke`(press)/`ValuePattern.SetValue`(setText)/`TogglePattern.Toggle`/`SelectionItemPattern.Select`/`SetFocus`(focus 兜底);均作用于元素、不抢前台  
- [x] secure 检测:`CurrentIsPassword` → `securetextbox` / `secure: true`,沿用 §11 同一套硬禁止 + 凭证代填闸门(在 core 层,与平台无关)  
- [x] control type → 归一 role(button/textbox/checkbox/…),与 macOS 共用 Agent role 词汇  
- [x] `active_backend()` 在 `cfg(windows)` 下选 `WindowsBackend`;macOS 代码 `cfg` 完全隔离  
- [x] **跨平台编译验证**:`cargo check --target x86_64-pc-windows-gnu` 零警告通过(在 macOS 开发机上交叉检查,针对真实 windows-rs 0.57 绑定);macOS 构建不受影响,core 8 测仍全过  
- [x] **napi 暴露(三平台接线)**:`computer*Json` 在 `lyra-accessibility-napi` 中无条件委托 core,不被 macOS cfg 挡住(只有 legacy `os_ax` 模块是 macOS-gated)。Windows 的 UIA 后端经 `cfg(windows)` 自动激活,无需 feature。staging(`stage-native-resources.ts`)已按平台产出 `.dll`/`.node`,无需改动  
- [ ] **Windows 真机运行验证**:实际在 Windows 上 `cargo build`(napi-build 需 `libnode.dll`,只能在真 Windows / 打包环境跑)+ 跑通记事本/资源管理器/设置等 app。core 源码已交叉 check 通过,仅 napi 打包步骤无法跨平台跑  

### D7 检查项

> 三条腿凑齐:同一个 `ComputerBackend` trait 现在被 macOS(AXUIElement FFI)、Windows(UIA COM)、Linux(AT-SPI2 / D-Bus)三套完全不同的原生 API 实现,Agent 侧看到的 `ComputerNode`/`osRef`/语义动作/secure 词汇完全一致。AT-SPI 是三者里最不同的——纯异步 D-Bus,没有同步入口。

- [x] `linux.rs`:`LinuxBackend` 实现 `ComputerBackend`,走 atspi 0.30(zbus / D-Bus)  
- [x] **async→sync 桥接**:atspi 全异步,用 `async_io::block_on` 把每个 trait 方法包成同步,无需 tokio、无全局 runtime  
- [x] `osRef` 方案 `atspi:<child-index-path>`,经 `get_child_at_index` 从注册表根重走;child→proxy 用 atspi 官方 `into_accessible_proxy` 转换——与 mac `osax:` / win `uia:` 同构  
- [x] 语义动作:Action 接口 `do_action`(挑 click/press/activate 动作索引)/ EditableText `set_text_contents`;均经 D-Bus、不抢前台  
- [x] secure 检测:`Role::PasswordText` → `securetextbox` / `secure: true`,沿用 core 层(平台无关)硬禁止 + 凭证代填闸门  
- [x] **feature 门控**:`linux-atspi` 默认关闭。atspi/zbus/async-io 整套异步栈仅在该 feature 开启时引入;默认构建(含 macOS/Windows)依赖图里 **0 个**相关 crate。Linux 不开 feature 时与其它平台一样落 `unsupported`  
- [x] **跨平台编译验证**:`cargo check --target x86_64-unknown-linux-gnu --features linux-atspi` 零警告通过(在 macOS 开发机交叉检查,针对真实 atspi 0.30 绑定);默认 macOS 构建不受影响,core 8 测仍全过  
- [x] **napi 暴露(Linux 接线)**:`lyra-accessibility-napi` 的 `[target.'cfg(target_os = "linux")'.dependencies]` 对 core 启用 `linux-atspi`,使 `active_backend()` 在 Linux 上选 `LinuxBackend`。已用 `cargo tree` 核实:macOS napi 构建 **0 个** atspi/zbus crate、Linux napi 构建 **7 个** atspi crate——feature 隔离正确。Linux napi 交叉 check 零警告通过  
- [ ] **Linux 真机运行验证**:需在带 AT-SPI 注册表的 Linux 桌面(GNOME/KDE)上 `cargo build --features linux-atspi` + 产出 `.so`/`.node` 并跑通真实 app。Wayland 下全局能力受限(§12 已注明 ROI 最低)  

### D5 检查项

> 定位:非视觉优先 + 视觉托底(§14.3)。这轮做"看见",不做"坐标点击"——坐标合成输入按 §14.2 留作显式、shared-only、平台分别实现的后续步骤,不让必然抢焦点的代码污染主路径。

- [x] `/tools/computer/see`:catalog manifest + schema(`scope: screen|focused-window`、`downsampleForVision`)+ `output_kind = artifact` + 描述/示例(中英)+ runtime target `lyraComputer.see`  
- [x] host 实现:`desktopCapturer` 截屏 → `materializeLumenCapture` 落 artifact → 返回 `{kind: computerSee, capabilityLevel: 3, fallback: "vision", imageArtifact, evidenceRefs}`。截屏函数 `captureScreen` 注入自 service.ts(平台桥接层),host 保持纯 marshaller、可测  
- [x] 纯观测:`computer.see` 只截图不动作、不抢焦点;消息里明确告知"没有桌面坐标点击工具,截图只用于理解状态"  
- [x] `computer.explain` 升级:语义不可达 / 平台不支持时返回 `fallback: "vision"` + `nextRecommendedAction: "computer.see"`(满足 §4 的 `fallback: "vision"` 要求)  
- [x] prompt `computer_use_section`:加"语义优先、视觉最后"升级链(map 无结果 / 无 AX 节点 / 需读图 → see)  
- [x] 测试:host 2 个 see 测试(未配置时报 `visualFallbackUnavailable`;配置后产出 artifact);core 8 测、tool-fs catalog、daemon link、desktop typecheck 全过  
- [ ] **坐标点击输入(后续,§14.2)**:`CGEvent`/`SendInput`/`XTest` 三平台合成输入,显式 shared-only 兜底工具,需绑定 `captureId` + act 后 observation diff。本轮未做  
- [ ] macOS「屏幕录制」权限首次申请的 UX(系统会弹,但未做引导)  

---

## 14. 已对齐的产品判断（2026-06）

### 14.1 平台优先级：mac 先做深，再 Windows

**认同。** 理由：

- Lyra 已有 macOS FFI 与 `ax-controller` 集成，能**最快验证**「语义动作 + 后台 + 闭环 diff」抽象是否成立。  
- 抽象一旦跑通，Windows UIA 因 API 更规整，**实现成本可能更低**——但不宜跳过 mac 验证阶段。  
- Linux 不阻塞 v1；Wayland 限制下 ROI 最低。

若未来数据显示主力用户在 Windows，可在 D1 与 D4 **并行**加人，但不改变「trait 先立、mac 先深」的顺序。

### 14.2 后台：必须真后台，还是抢了也能接受？

**Lyra 倾向：能不抢就不抢；shared 模式可接受短暂抢焦点。**

| 模式 | 后台要求 |
|------|----------|
| `background-semantic` / `isolated-session` | **必须真后台**（语义 API only） |
| `shared`（Follow） | 可接受偶发 activate，用于用户可见演示 |

坐标合成 **不进** `background-semantic` 第一版；仅 shared + 显式兜底工具，且描述中警告抢焦点。

### 14.3 纯非视觉 vs 非视觉优先 + 视觉托底

**Lyra 选择：非视觉优先 + 视觉托底**（不是纯盲飞）。

- 默认：`map → act → diff`，Agent 不见坐标。  
- 困难场景（复杂原生 UI、无 AX、canvas）：`explain` 升级 → 可选 `computer.see` 给模型看截图辅助决策，再决定是否坐标兜底。  
- 与浏览器策略一致：DOM → AX → see/vact。

「像浏览器操作一样」= **语义树为主操作面**，不是禁止截图，而是**截图不主导协议**。

### 14.4 仍待拍板

1. 操控范围：白名单 app vs 开放 AX？  
2. 外部浏览器默认 `open-in-lyra`？  
3. `computer.see` 每 turn 预算上限？  

---

## 15. 结论

- **两条主线**：语义优先；后台走 API 不走鼠标。  
- **Computer Semantic Runtime** 是 Lyra 与「截图 Computer Use」的本质区别。  
- **Computer Tree + handle** 让桌面操控像 `querySelector + click`。  
- **三级能力**：内部 IPC → OS AX → 视觉，逐级升级。  
- 三件事（多平台 / 后台 / 非视觉）是**语义动作**的副产品，不是三个独立项目。  
- **osRef 契约 + act 后 diff** 是地基；没有闭环验证，非视觉就是玩具。  
- Lyra 已有 half the puzzle——下一步：`lyra-computer-use-core` + macOS backend 收编，而不是再加一个 vision agent。  

---

## 附录 A：代码锚点

| 模块 | 路径 |
|------|------|
| macOS OS AX（待收编为 backend） | `crates/lyra-accessibility-napi/src/lib.rs` |
| 浏览器 observation / capabilities | `apps/desktop/.../agent-observation-runtime.ts`, `ax-detectors.ts` |
| AX tool host 参考 | `apps/desktop/.../ax-tool-host.ts`（拟类比 computer tool host） |
| browser_ax 工具 | `crates/lyra-tool-fs-core/src/catalog/browser_ax.rs` |
| AX 控制器 | `apps/desktop/src/main/workbench-browser/view-manager-runtime/ax-controller.ts` |
| 外部 page 拖放 | `apps/desktop/.../external-page-drag.ts` |
| Agent 策略 | `crates/lyra-agent-runtime/src/prompt_policy.rs` |
| Plugin `ai-computer` | `packages/plugin-sdk` |

## 附录 B：vs 典型视觉 Computer Use

| 维度 | 截图 + 坐标 | Lyra Computer Semantic Runtime |
|------|-------------|--------------------------------|
| 主协议 | 像素坐标 | `nodeId` / handle |
| 树结构 | 无 | Computer Tree |
| 后台 | 难 | L1 IPC + L2 AX |
| 成本 | 高 vision | 低结构化 |
| 可审计 | 弱 | snapshot + diff |
| 跨平台 | 模型统一 | adapter 分平台、schema 统一 |

---

*文档维护：随 D0–D1 实施更新 §11 检查项与 §12 决策。*