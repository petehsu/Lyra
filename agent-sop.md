证据收集完毕。以下是深度对比分析。

---

## Lyra vs vscode / zed / opencode 深度对比

### 一、项目规模与栈选择对照

| 维度 | Lyra | zed | vscode | opencode |
|------|------|-----|--------|----------|
| 渲染层 | Electron 41 + React 18 | 自研 GPUI (Metal/wgpu/GPU 直绘) | Electron + TS | opentui (TUI) |
| Native 层 | Rust, ~67 crates | Rust, ~200+ crates | 无 native | 无 native |
| 语言栈 | Rust + TypeScript 双栈 | 纯 Rust | 纯 TypeScript | 纯 TypeScript (Bun) |
| 语言解析 | codegraph 40 crate 自维护 | tree-sitter grammar 编译引入 | 扩展系统，社区提供 | tree-sitter (web-tree-sitter) |
| 重型运行时依赖 | v8 + fastembed(ORT) + rocksdb + rusqlite + sqlx + starlark | wasmtime + tree-sitter | 无 | 无 |
| 硬件依赖 | 蓝牙/HID/摄像头/USB/串口/音频 | 无（纯编辑器） | 无 | 无 |
| release LTO | `fat` + `codegen-units=1` | `thin` + 对 zed 单独 `cg=16` | N/A | N/A |
| clippy 策略 | deny `unwrap_used`/`expect_used` + 大量 `manual_*` | `style = allow`，只 deny 少数 | N/A | N/A |

---

### 二、核心问题（按严重度排序）

#### 问题 1：codegraph 40 语言解析器 —— 最大的 sunk cost

`crates/codegraph-*` 有 **41 个 `lib.rs`**，覆盖 COBOL、Fortran、Verilog、Tcl、Erlang、Haskell、OCaml、Groovy、Solidity 等。

这不是差异化优势，是维护黑洞：

- **zed** 用 tree-sitter 原生 grammar，编译时引入 C 源，不需要自己写 40 个 Rust crate
- **vscode** 靠扩展系统，语言支持由社区提供，核心不背这个包袱
- **opencode** 用 `web-tree-sitter`，WASM grammar 按需加载

40 个 crate 意味着 40 套 CI、40 套测试、40 个可能的 breakage 点。其中 COBOL/Fortran/Verilog/Tcl 的用户基数接近零。这在商业初期是纯消耗——花在 COBOL parser 上的每一小时都是从核心 Computer Use 能力上抢走的。

**建议**：砍到 5-8 个主流语言（Python/TS/Go/Rust/Java/C++/Bash），其余改为 tree-sitter grammar 按需加载或直接删除。等有用户数据再决定是否加。

#### 问题 2：release 编译时间灾难

`Cargo.toml` 里的配置：

```toml
[profile.release]
lto = "fat"
codegen-units = 1
strip = "symbols"
```

`fat LTO + codegen-units=1` 是**最慢的组合**，加上 67 个 crate 和 v8/fastembed/rocksdb/starlark 这些重型依赖，release 构建保守估计 30-60 分钟。

对比 zed 的做法（务实到值得逐句学）：

```toml
[profile.release]
lto = "thin"
codegen-units = 1

[profile.release.package]
zed = { codegen-units = 16 }   # 只对最终二进制放宽
```

zed 还对 dev profile 做了精细分层：proc-macros 单独 `opt-level=3`，单文件 crate 用 `codegen-units=1` 加速全 workspace 编译。

**影响**：CI/CD 周转慢、发版慢、热修复慢。商业产品的迭代速度直接受编译时间制约。

**建议**：`lto = "thin"`，对 `lyrad`/`lyra-cli` 最终二进制单独 `codegen-units=16`。fat LTO 在这个规模下收益不值得代价。

#### 问题 3：Electron 渲染层的性能天花板

`apps/desktop/package.json` 的 dependencies 告诉了一个沉重的故事：

- `monaco-editor` (完整 IDE 编辑器，~5MB+)
- `mermaid` (图表渲染)
- `three.js` + `@react-three/fiber` (3D 渲染)
- `xterm` (终端模拟器)
- `playwright` (浏览器自动化，打包了完整 Chromium)
- `@novnc/novnc` (VNC 客户端)
- `darkreader` (暗色模式注入)
- 大量 Radix UI 组件

这些全在 Electron 渲染进程跑。`extraResources` 里还打包了 playwright browsers、aria2、rust-analyzer LSP、native modules。

**打包体积估算**：Electron runtime (~150MB) + playwright Chromium (~200MB) + native modules + aria2 + LSP → 安装包很可能 400-600MB+。

对比：
- **zed**：自研 GPUI，GPU 直绘，无 Electron 中间层，二进制 ~50MB
- **vscode**：同样 Electron，但微软有数百人团队做性能优化，且有远程开发（UI 和计算分离）的架构出口
- **opencode**：纯 TUI，~几 MB

Lyra 的 `workspace-surfaces.ts` 做了 tab 级资源生命周期调度（foreground/visible/hotHidden），设计是合理的——但这是**资源调度**，不是**渲染性能**。真正的卡顿来源是 Electron + React + monaco + mermaid + three.js 同进程渲染时的帧时间。

**风险**：多 tab 场景下（浏览器 + 终端 + 编辑器 + Agent 对话），渲染进程内存可能轻松破 2GB，GC 停顿和 React 重渲染会导致明显卡顿。

#### 问题 4：三个存储引擎共存

Cargo.toml 同时引入：
- `rocksdb = "0.22"` (嵌入式 KV)
- `rusqlite = { features = ["bundled"] }` (SQLite)
- `sqlx = { features = ["sqlite", ...] }` (异步 SQLite ORM)

三个存储引擎在一个 workspace 里。如果没有明确的职责划分（比如 rocksdb 做 cache、sqlite 做 metadata、sqlx 做 session），这是复杂度扩散。

**建议**：确认每个引擎的职责边界。如果能用一个解决，删掉其余的。

#### 问题 5：硬件依赖矩阵的必要性存疑

`btleplug`（蓝牙）、`hidapi`（HID 设备）、`nokhwa`（摄像头）、`serialport`（串口）、`rusb`（USB）、`network-interface`、`cpal`（音频）。

对一个 "AI 工作站 / Computer Use" 定位的产品，这些是核心需求还是"万一要用"的过度工程？每一个都是 native 依赖，增加编译时间、跨平台构建复杂度和打包体积。

**建议**：逐个确认是否有活跃调用路径。没有的移到 feature gate 后面，默认不编译。

#### 问题 6：clippy 策略与阶段不匹配

`deny unwrap_used` + `deny expect_used` + 大量 `manual_*` deny。

zed 的策略是 `style = allow`，只 deny `dbg_macro`/`todo`/`redundant_clone` 等少数关键规则。zed 的注释原话："restrict style rules slows down shipping code"。

在商业初期，迭代速度 > 代码完美度。`unwrap_used = deny` 会迫使开发者写大量 `?` 和 `match`，在原型阶段是纯摩擦。

**建议**：降为 `warn`，只保留 `redundant_clone` 和 `dbg_macro` 的 deny。

---

### 三、商业可行性评估

#### 正面因素（不要低估）

1. **Computer Use 语义树方案**是真正的技术差异化。架构文档显示 `ComputerBackend` trait 已被 macOS/Windows/Linux 三套完全不同的原生 API 实现，Agent 侧词汇统一。这不是 demo，是已验证的抽象。

2. **非视觉优先 + 视觉托底**的产品判断正确——比截图猜坐标方案在 token 成本、延迟、可审计性上都优一个量级。

3. **性能内核设计意识**：`workspace-surfaces.ts` 的 tab 生命周期调度 + Rust 侧 `performance-core` 压力采样，说明团队有性能意识，不是完全没考虑。

4. **架构边界工具链**：`tools/verify-boundaries.ts`、`verify-architecture-health.ts` 等自定义 lint，说明在主动管理模块边界——这在 vscode 级别的项目里才见到。

#### 风险因素

1. **打包体积 → 下载转化率**：400-600MB 的安装包在个人开发者市场是显著的转化漏斗损耗。zed ~50MB，opencode ~几 MB。

2. **编译时间 → 发版节奏**：fat LTO + 67 crate + 重型依赖，每次 release 是几十分钟的等待。商业产品需要快速响应 bug report。

3. **双语言栈 → 招聘和协作成本**：一个功能改动可能涉及 Rust core → napi bridge → TS service → React UI 四层。小团队下这是协作摩擦。

4. **40 语言 codegraph → 持续维护税**：每年 tree-sitter grammar 升级、Rust edition 升级、CI 维护，40 个 crate 是固定成本。

5. **Electron 渲染天花板 → 用户体验上限**：当用户开 10 个 tab（浏览器 + 终端 + 编辑器 + Agent），Electron 的内存和帧时间会成为体验瓶颈。zed 用 GPUI 绕过了这个天花板，但 Lyra 没有这个选项（已经深度绑定 Electron + React 生态）。

---

### 四、优先行动建议

| 优先级 | 行动 | 预期收益 |
|--------|------|----------|
| P0 | codegraph 砍到 5-8 语言，其余删除或 feature gate | 减少 ~35 crate 编译/CI/维护成本 |
| P0 | release profile 改 `lto="thin"` + 最终二进制 `cg=16` | release 编译时间砍半以上 |
| P1 | 确认 rocksdb/rusqlite/sqlx 职责，合并到 ≤2 个 | 降低存储层复杂度 |
| P1 | 硬件依赖做 feature gate，默认不编译 | 减少默认构建体积和时间 |
| P1 | clippy `unwrap_used`/`expect_used` 降为 warn | 减少原型阶段摩擦 |
| P2 | 评估 playwright browsers 是否可改为按需下载 | 安装包体积可能砍 200MB |
| P2 | 渲染层做 tab 级懒加载（monaco/mermaid/three 按需 import） | 降低多 tab 内存峰值 |

---

### 一句话结论

Lyra 的 **Computer Use 语义树架构**是真正的技术资产，差异化成立。但 **codegraph 40 语言、fat LTO、Electron 重渲染栈、三存储引擎、硬件依赖矩阵**构成了严重的工程债务——这些不是功能问题，是"每发一版都要背的税"。在商业化前期，砍掉非核心的广度（语言数、硬件支持），把编译和打包做轻，比加新功能更重要。zed 的务实（thin LTO、style allow、tree-sitter grammar 而非自维护 parser crate）值得逐条学习。